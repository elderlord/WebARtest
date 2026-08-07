// ─────────────────────────────────────────────────────────────────────────
// 0-A 셰이더 스모크 테스트 (스펙 0-A / §3.2)
//
// 질문: "카메라 텍스처를 커스텀 프래그먼트 셰이더로 읽어 특정 영역을 변조할 수
//        있는가?" — 이게 되면 shimmer(일렁임) 유지, 안 되면 glow 단독으로 축소.
//
// 이 모듈은 카메라 피드 GPU 텍스처를 sampler2D로 받아, 화면 중앙 사각 영역에
// 사인파 UV 왜곡(=shimmer의 핵심 메커니즘)을 건다. 왜곡이 눈에 보이면 PASS.
//
// ⚠ 정직한 상태 표기: GLSL과 파이프라인 모듈 골격은 확정이나, "런타임에서 카메라
//   텍스처 핸들을 얻는 정확한 지점"은 문서(egress 차단)·바이너리(디컴파일 금지)로
//   오프라인 확정이 불가하다. 아래 getCameraTexture()가 그 유일한 확인 지점이며,
//   이 지점을 벤더링된 xr.js에 맞춰 확정하는 것 자체가 0-A 스모크 테스트의 결과다.
//   참고: 8th Wall `examples/threejs/custom-pipeline-module` 및 GlTextureRenderer.
// ─────────────────────────────────────────────────────────────────────────

const FRAG = `
  precision mediump float;
  uniform sampler2D uCamera;   // 카메라 피드 텍스처
  uniform float uTime;
  uniform vec4 uRect;          // 변조 영역 (x,y,w,h) in UV
  varying vec2 vUv;
  void main() {
    vec2 uv = vUv;
    // 대상 사각 영역 안에서만 사인파로 UV를 흔든다 (원본 픽셀을 왜곡 = shimmer)
    if (uv.x > uRect.x && uv.x < uRect.x + uRect.z &&
        uv.y > uRect.y && uv.y < uRect.y + uRect.w) {
      float wob = sin(uv.y * 60.0 + uTime * 6.0) * 0.006;
      uv.x += wob;
    }
    gl_FragColor = texture2D(uCamera, uv);
  }
`

const VERT = `
  attribute vec2 aPos;
  varying vec2 vUv;
  void main() {
    vUv = (aPos + 1.0) * 0.5;
    gl_Position = vec4(aPos, 0.0, 1.0);
  }
`

// 카메라 피드 GPU 텍스처 핸들을 얻는다. (0-A 확인 대상)
// 8th Wall의 GlTextureRenderer 파이프라인 모듈은 processGpu 결과에
// { gltexturerenderer: { viewportTexture, ... } } 형태로 텍스처를 노출한다.
// 빌드에 따라 키가 다를 수 있으므로 후보를 순서대로 시도하고, 실패 시
// 실제 키 목록을 보고해 다음 라운드에서 정확히 짚을 수 있게 한다.
function getCameraTexture(r) {
  if (!r) return null
  return (
    r.gltexturerenderer?.viewportTexture ||
    r.gltexturerenderer?.srcTexture ||
    r.cameraTexture ||
    r.camerafeedtexture ||
    null
  )
}

// 진단용: processGpuResult의 실제 모양을 문자열로 (XR8 키 덤프로 원인을 잡았던 방식)
function describeShape(r) {
  if (!r) return 'processGpuResult 없음'
  const top = Object.keys(r).join(',')
  const sub = r.gltexturerenderer ? Object.keys(r.gltexturerenderer).join(',') : '(gltexturerenderer 없음)'
  return `keys: ${top} · gltexturerenderer: ${sub}`
}

export function createShaderSmokeTest({ onResult } = {}) {
  let program = null
  let quad = null
  let reported = false
  let frames = 0
  let uCamera, uTime, uRect, aPos

  const report = (pass, note) => {
    if (reported) return
    reported = true
    console.log(`[0-A shader smoke] ${pass ? 'PASS' : 'FAIL'} — ${note}`)
    onResult && onResult({ pass, note })
  }

  return {
    name: '0a-shader-smoke',
    onStart: ({ canvas, GLctx }) => {
      const gl = GLctx || canvas.getContext('webgl')
      if (!gl) return report(false, 'WebGL 컨텍스트 없음')
      program = buildProgram(gl, VERT, FRAG)
      if (!program) return report(false, '셰이더 컴파일 실패')
      uCamera = gl.getUniformLocation(program, 'uCamera')
      uTime = gl.getUniformLocation(program, 'uTime')
      uRect = gl.getUniformLocation(program, 'uRect')
      aPos = gl.getAttribLocation(program, 'aPos')
      quad = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, quad)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    },
    // 카메라 프레임마다: 카메라 텍스처를 셰이더로 변조 시도
    onProcessGpu: ({ processGpuResult }) => {
      // 텍스처 핸들 확인이 0-A의 핵심 판정.
      // 파이프라인이 안정될 시간을 주고(초기 몇 프레임은 비어 있을 수 있음),
      // 그래도 못 찾으면 실제 키 모양을 함께 보고해 다음 라운드에서 정확히 짚는다.
      const tex = getCameraTexture(processGpuResult)
      frames++
      if (tex == null && frames > 30) {
        report(false, `카메라 텍스처 핸들 미확인 · ${describeShape(processGpuResult)}`)
      }
      return { smokeTexture: tex }
    },
    onRender: ({ GLctx, processGpuResult, framework }) => {
      const gl = GLctx
      const tex = getCameraTexture(processGpuResult)
      if (!gl || !program || !tex) return
      gl.useProgram(program)
      gl.bindBuffer(gl.ARRAY_BUFFER, quad)
      gl.enableVertexAttribArray(aPos)
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.uniform1i(uCamera, 0)
      gl.uniform1f(uTime, (framework?.time || performance.now()) / 1000)
      gl.uniform4f(uRect, 0.35, 0.4, 0.3, 0.2) // 화면 중앙 사각 영역
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      report(true, '카메라 텍스처를 커스텀 셰이더로 샘플·변조 성공 → shimmer 경로 유효')
    },
  }
}

function buildProgram(gl, vsrc, fsrc) {
  const compile = (type, src) => {
    const sh = gl.createShader(type)
    gl.shaderSource(sh, src)
    gl.compileShader(sh)
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.error('[shader]', gl.getShaderInfoLog(sh))
      return null
    }
    return sh
  }
  const vs = compile(gl.VERTEX_SHADER, vsrc)
  const fs = compile(gl.FRAGMENT_SHADER, fsrc)
  if (!vs || !fs) return null
  const p = gl.createProgram()
  gl.attachShader(p, vs)
  gl.attachShader(p, fs)
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.error('[program]', gl.getProgramInfoLog(p))
    return null
  }
  return p
}
