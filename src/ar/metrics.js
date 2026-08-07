import * as THREE from 'three'

// 0단계 계측값 계산 헬퍼.
// 이미지 타겟의 월드 변환(위치/회전)과 카메라로부터 다음을 도출한다:
//   - 거리: 카메라 원점 ~ 타겟 중심 (cm)  ※ 스펙 §6.2: world scale calibration
//           전에는 nominal 값. three 단위=1m 가정에 의존.
//   - 기울기: 타겟 법선과 카메라 시선의 각도 (deg, 정면 = 0)
//   - Pose 변동: 최근 N프레임 타겟 위치의 3D 표준편차 (mm)
//     ※ 스펙 §6.1: 손떨림+카메라이동+pose노이즈의 합. tracking precision 아님.
export class Metrics {
  constructor(windowSize = 30) {
    this.windowSize = windowSize
    this.samples = [] // THREE.Vector3[]
  }

  reset() {
    this.samples.length = 0
  }

  // targetPos, targetQuat: 타겟의 월드 위치/회전. camera: THREE.Camera
  update(targetPos, targetQuat, camera) {
    // 거리 (three 단위는 m 가정 → cm 변환)
    const distanceCm = targetPos.distanceTo(camera.position) * 100

    // 기울기: 타겟 법선(+Z를 타겟 회전으로 변환) vs 타겟→카메라 방향
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(targetQuat).normalize()
    const toCam = new THREE.Vector3().subVectors(camera.position, targetPos).normalize()
    const tiltDeg = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(normal.dot(toCam), -1, 1)))

    // Pose 변동: 위치 표본 표준편차
    this.samples.push(targetPos.clone())
    if (this.samples.length > this.windowSize) this.samples.shift()
    const poseVarMm = this._stdDevMm()

    return { distanceCm, tiltDeg, poseVarMm }
  }

  _stdDevMm() {
    const n = this.samples.length
    if (n < 2) return 0
    const mean = new THREE.Vector3()
    for (const s of this.samples) mean.add(s)
    mean.divideScalar(n)
    let sumSq = 0
    for (const s of this.samples) sumSq += s.distanceToSquared(mean)
    // RMS 편차(m) → mm
    return Math.sqrt(sumSq / n) * 1000
  }
}

// 간단한 FPS 측정기 (지수 이동평균)
export class FpsMeter {
  constructor() {
    this.fps = 0
    this._last = null
  }
  tick(now) {
    if (this._last != null) {
      const dt = now - this._last
      if (dt > 0) {
        const inst = 1000 / dt
        this.fps = this.fps ? this.fps * 0.9 + inst * 0.1 : inst
      }
    }
    this._last = now
    return this.fps
  }
}
