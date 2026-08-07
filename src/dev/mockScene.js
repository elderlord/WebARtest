import * as THREE from 'three'
import { createAlignmentBox } from '../ar/alignmentBox.js'

// DEV 모드: window.XR8 런타임과 컴파일된 타겟이 아직 없을 때 실행된다.
// AR은 아니지만 — three.js 렌더, HUD, 정합 박스 지오메트리가 실기기에서
// 제대로 뜨는지 사진 없이도 점검할 수 있게 한다.
// 모의 "패널" 위에 정합 박스를 얹고 천천히 회전시키며, HUD에 모의 계측값을 흘린다.
export function startMockScene({ canvas, hud }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(60, 1, 0.01, 100)
  camera.position.set(0, 0, 1.2)

  // 모의 패널 (A4 가로 비율 근사, 실측 크기 감각용)
  const W = 0.4
  const H = 0.28
  const panel = new THREE.Mesh(
    new THREE.PlaneGeometry(W, H),
    new THREE.MeshBasicMaterial({ color: 0x1f2937 })
  )
  scene.add(panel)

  const box = createAlignmentBox()
  box.resize(W, H)
  box.visible = true
  scene.add(box)

  hud.setFound(true)

  const resize = () => {
    const w = window.innerWidth
    const h = window.innerHeight
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  window.addEventListener('resize', resize)
  resize()

  let raf = 0
  const start = performance.now()
  const loop = (now) => {
    const t = (now - start) / 1000
    // 천천히 흔들어 살아있음을 보이고, 모의 계측값을 갱신
    const yaw = Math.sin(t * 0.4) * 0.35
    panel.rotation.y = yaw
    box.rotation.y = yaw

    hud.setMetrics({
      distanceCm: 120 + Math.sin(t * 0.6) * 8,
      tiltDeg: Math.abs(THREE.MathUtils.radToDeg(yaw)),
      poseVarMm: 0.2 + Math.abs(Math.sin(t * 3)) * 0.3,
    })
    hud.setFps(1000 / 16)

    renderer.render(scene, camera)
    raf = requestAnimationFrame(loop)
  }
  raf = requestAnimationFrame(loop)

  return () => {
    cancelAnimationFrame(raf)
    window.removeEventListener('resize', resize)
  }
}
