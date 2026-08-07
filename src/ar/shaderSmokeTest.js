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

// 벤더링된 런타임에서 카메라 피드 텍스처 핸들을 얻는 지점. (0-A 확인 대상)
// 8th Wall camera pipeline은 onProcessGpu 결과 / GlTextureRenderer를 통해 카메라
// 텍스처를 노출한다. 실기기에서 이 함수가 유효한 WebGLTexture를 반환하면 PASS.
function getCameraTexture(processGpuResult /*, gl */) {
  // TODO(0-A, 실기기): 아래 후보 중 벤더링된 xr.js가 노출하는 실제 경로로 확정.
  //   - processGpuResult?.camerapixelarray / .cameraTexture 계열
  //   - XR8.GlTextureRenderer가 그리는 텍스처 참조
  // 확정 전에는 null → 테스트는 GRACEFUL FAIL로 기록(오류 아님).
  return processGpuResult && (processGpuResult.cameraTexture || null)
}

export function createShaderSmokeTest({ onResult } = {}) {
  let program = null
  let quad = null
  let reported = false
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
      // 텍스처 핸들 확인이 0-A의 핵심 판정
      const tex = getCameraTexture(processGpuResult)
      if (tex == null) {
        report(false, '카메라 텍스처 핸들 미확인 → getCameraTexture()를 벤더 런타임에 맞춰 확정 필요 (shimmer 불가면 glow 단독)')
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
