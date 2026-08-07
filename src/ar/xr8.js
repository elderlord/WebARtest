import * as THREE from 'three'
import { createAlignmentBox } from './alignmentBox.js'
import { Metrics, FpsMeter } from './metrics.js'
import { createShaderSmokeTest } from './shaderSmokeTest.js'
import { showBanner } from '../hud.js'
import { RUNTIME } from './runtime.js'

// 8th Wall XR8 카메라 파이프라인 위에 three.js 씬을 얹고,
// 이미지 타겟 인식 시 정합 박스를 타겟에 부착한다. (0단계 계측 하네스)
//
// 전제:
//   - window.XR8 런타임이 로드되어 있어야 한다 (self-host, /public/xr8/ 참고)
//   - IMAGE_TARGET_NAME이 컴파일된 타겟의 이름과 일치해야 한다
//     (사진이 없는 현재는 플레이스홀더. image-target-cli로 컴파일 후 교체)
//
// 참고 API: XR8.XrController.configure({ imageTargets }), reality.imagefound/updated/lost,
//           XR8.Threejs.pipelineModule(), XR8.Threejs.xrScene()

// TODO(사진 확보 후): 컴파일된 이미지 타겟 이름으로 교체.
export const IMAGE_TARGET_NAME = 'panel-placeholder'

// opts.shaderSmokeTest: true면 0-A 셰이더 스모크 테스트 모듈을 파이프라인에 추가한다.
//   (?smoke 쿼리로 켜는 것을 권장 — 아래 startXr8 호출부에서 판단)
export function startXr8({ canvas, hud, shaderSmokeTest = false } = {}) {
  const XR8 = window.XR8
  const box = createAlignmentBox()
  const metrics = new Metrics(30)
  const fps = new FpsMeter()

  // 타겟이 마지막으로 보고한 실측 크기 (imagefound/updated에서 갱신)
  let lastWidth = 1
  let lastHeight = 1

  const attachBox = (detail) => {
    const { position, rotation, scaledWidth, scaledHeight } = detail
    box.position.copy(position)
    box.quaternion.copy(rotation)
    // 주의(스펙 §6.3): detail에는 scale과 scaledWidth/Height가 함께 온다.
    // scaledWidth/Height가 이미 scale이 반영된 실측 크기이므로, box.scale까지
    // 따로 걸면 이중 적용이 된다. 여기서는 크기의 단일 출처로 scaledWidth/Height만
    // 쓴다(geometry를 실측 크기로 resize). 실 런타임 연결 시 줄자로 검증해
    // 규약이 다르면 이 지점만 조정한다.
    if (scaledWidth && scaledHeight) {
      lastWidth = scaledWidth
      lastHeight = scaledHeight
      box.resize(scaledWidth, scaledHeight)
    }
    box.visible = true
  }

  const imageTargetModule = () => ({
    name: 'panel-alignment',
    onStart: () => {
      const { scene } = XR8.Threejs.xrScene()
      scene.add(box)
    },
    // 매 프레임: 계측값 갱신
    onUpdate: () => {
      const now = performance.now()
      hud.setFps(fps.tick(now))
      if (box.visible) {
        const { camera } = XR8.Threejs.xrScene()
        const m = metrics.update(box.position, box.quaternion, camera)
        hud.setMetrics(m)
      }
    },
    listeners: [
      {
        event: 'reality.imagefound',
        process: ({ detail }) => {
          if (detail.name !== IMAGE_TARGET_NAME) return
          metrics.reset()
          attachBox(detail)
          hud.setFound(true)
        },
      },
      {
        event: 'reality.imageupdated',
        process: ({ detail }) => {
          if (detail.name !== IMAGE_TARGET_NAME) return
          attachBox(detail)
        },
      },
      {
        event: 'reality.imagelost',
        process: ({ detail }) => {
          if (detail.name !== IMAGE_TARGET_NAME) return
          box.visible = false
          metrics.reset()
          hud.setFound(false)
        },
      },
    ],
  })

  // XR8.Threejs 파이프라인 모듈은 전역 window.THREE를 요구한다(0-A 실측 확인).
  // 우리는 three를 ES 모듈로 번들하므로 전역에 노출해 준다.
  if (!window.THREE) window.THREE = THREE

  // 이 빌드에서 파이프라인 모듈이 다른 이름일 수 있다. 없으면 어느 것이 없는지 명확히 보고.
  const need = ['GlTextureRenderer', 'Threejs', 'XrController']
  const missing = need.filter((k) => !XR8[k] || typeof XR8[k].pipelineModule !== 'function')
  if (missing.length) {
    throw new Error(`XR8 모듈 없음: ${missing.join(', ')} · 사용가능 키: ${Object.keys(XR8).join(',')}`)
  }

  const modules = [
    XR8.GlTextureRenderer.pipelineModule(), // 카메라 피드를 캔버스에 렌더
    XR8.Threejs.pipelineModule(), // three.js 씬 관리
    XR8.XrController.pipelineModule(), // 트래킹 (SLAM은 조건부: runtime.enableWorldTracking)
  ]

  // 이미지 타겟은 실제 컴파일 타겟이 있을 때만 등록한다.
  // 0-A(사진 없음, placeholder)에서는 타겟 없이 카메라+HUD만 띄운다.
  const hasRealTarget = IMAGE_TARGET_NAME && IMAGE_TARGET_NAME !== 'panel-placeholder'
  if (hasRealTarget) modules.push(imageTargetModule())

  // 0-A 셰이더 스모크 테스트 (?smoke): 카메라 텍스처 셰이더 접근 판정
  if (shaderSmokeTest) {
    modules.push(
      createShaderSmokeTest({
        onResult: ({ pass, note }) =>
          showBanner(`<b>셰이더 스모크: ${pass ? 'PASS' : 'FAIL'}</b><br>${note}`),
      })
    )
  }

  XR8.addCameraPipelineModules(modules)

  // 0-B는 이미지 타겟 단독(disableWorldTracking: true). SLAM은 0-B2에서
  // runtime.enableWorldTracking()으로만 켠다.
  XR8.XrController.configure({ disableWorldTracking: RUNTIME.disableWorldTracking })

  if (hasRealTarget) {
    XR8.XrController.configure({ imageTargets: [IMAGE_TARGET_NAME] })
  } else {
    // 타겟 없이 카메라만: HUD에 0-A 상태 표시
    hud.setFound(false)
    showBanner(
      `<b>0-A 런타임 OK</b> — XR8 로드·카메라 기동. 타겟 미등록(사진 대기).<br>` +
        `<code>?smoke</code>로 셰이더 접근 판정.`
    )
  }

  // 캔버스 드로잉 버퍼를 뷰포트에 맞춘다.
  // XRExtras.FullWindowCanvas를 쓰지 않으므로 직접 처리해야 한다. 이걸 안 하면
  // 버퍼가 기본 300x150이라 카메라 피드가 화면 일부에만 그려진다(0-A 실측 확인).
  const fitCanvas = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = Math.round(window.innerWidth * dpr)
    const h = Math.round(window.innerHeight * dpr)
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    // three 렌더러가 이미 있으면 함께 갱신
    const scene = XR8.Threejs.xrScene && XR8.Threejs.xrScene()
    if (scene && scene.renderer) {
      scene.renderer.setSize(window.innerWidth, window.innerHeight, false)
    }
  }
  fitCanvas()
  window.addEventListener('resize', fitCanvas)
  window.addEventListener('orientationchange', () => setTimeout(fitCanvas, 200))

  XR8.run({ canvas })
}
