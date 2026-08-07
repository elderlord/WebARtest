import * as THREE from 'three'

// 문서 §5 0단계: "효과 없이 정합 확인용 와이어프레임 박스만 표시".
// 이 박스는 어떤 시각 효과도 아니다 — 인쇄 패널의 실제 테두리에
// 가상 박스가 얼마나 정확히 겹치는지(정합 오차)를 육안으로 재기 위한 자.
//
// 구성:
//   - 타겟 실측 크기에 맞춘 와이어프레임 사각 테두리 (패널 테두리와 겹쳐 봐야 함)
//   - 중앙 축 헬퍼 (X빨강/Y초록/Z파랑, 회전·기울기 정합 확인)
//   - 네 모서리 점 (근접 시 코너 어긋남을 집어내기 쉽게)
export function createAlignmentBox() {
  const group = new THREE.Group()
  group.name = 'alignment-box'

  // 1) 사각 테두리 (초기 1×1, imagefound에서 실측 크기로 resize)
  const border = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)),
    new THREE.LineBasicMaterial({ color: 0x34d399 })
  )
  border.name = 'border'
  group.add(border)

  // 2) 축 헬퍼 (기본 길이, resize에서 스케일)
  const axes = new THREE.AxesHelper(0.5)
  axes.name = 'axes'
  group.add(axes)

  // 3) 모서리 점
  const cornerGeo = new THREE.SphereGeometry(0.01, 12, 12)
  const cornerMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24 })
  const corners = new THREE.Group()
  corners.name = 'corners'
  for (let i = 0; i < 4; i++) corners.add(new THREE.Mesh(cornerGeo, cornerMat))
  group.add(corners)

  group.visible = false

  // 타겟 실측 크기(월드 단위, three=m 가정)에 박스를 맞춘다.
  group.resize = (width, height) => {
    const w = width || 1
    const h = height || 1
    border.geometry.dispose()
    border.geometry = new THREE.EdgesGeometry(new THREE.PlaneGeometry(w, h))

    const half = Math.min(w, h) * 0.5
    axes.scale.setScalar(Math.max(half, 0.01) / 0.5)

    const cx = w / 2
    const cy = h / 2
    const pts = [
      [-cx, cy, 0],
      [cx, cy, 0],
      [cx, -cy, 0],
      [-cx, -cy, 0],
    ]
    corners.children.forEach((m, i) => m.position.set(...pts[i]))
  }

  return group
}
