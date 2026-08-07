import * as THREE from 'three'
import { createAlignmentBox } from './alignmentBox.js'
import { Metrics, FpsMeter } from './metrics.js'

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

export function startXr8({ canvas, hud }) {
  const XR8 = window.XR8
  const box = createAlignmentBox()
  const metrics = new Metrics(30)
  const fps = new FpsMeter()

  // 타겟이 마지막으로 보고한 실측 크기 (imagefound/updated에서 갱신)
  let lastWidth = 1
  let lastHeight = 1

  const attachBox = (detail) => {
    const { position, rotation, scale, scaledWidth, scaledHeight } = detail
    box.position.copy(position)
    box.quaternion.copy(rotation)
    if (scale != null) box.scale.setScalar(scale)
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

  XR8.addCameraPipelineModules([
    XR8.GlTextureRenderer.pipelineModule(), // 카메라 피드를 캔버스에 렌더
    XR8.Threejs.pipelineModule(), // three.js 씬 관리
    XR8.XrController.pipelineModule(), // 6DoF 트래킹 (SLAM 바이너리 존재 시 자세 유지)
    imageTargetModule(),
  ])

  // 인식할 이미지 타겟 등록
  XR8.XrController.configure({ imageTargets: [IMAGE_TARGET_NAME] })

  XR8.run({ canvas })
}
