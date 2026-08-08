import * as THREE from 'three'

// 0-D 단어 정합 probe
//
// 계획 점검(GPT 교차검토)의 지적: 이 프로젝트의 관심사는 "패널 외곽 정합"이 아니라
// **단어 위치 정합**이다. 외곽선이 5mm 어긋나는 건 큰 패널에선 사소해 보여도
// 16mm 글자 위에서는 치명적이다. 그래서 좌상/중앙/우하 단어마다 probe를 얹어
// translation·rotation·scale·perspective drift를 위치별로 동시에 본다.
//
// 좌표는 **추적 영역 기준 정규화(0~1)** 로 받는다 (스펙 Phase 2 규약).
//   u: 좌→우, v: 상→하, w/h: 크기 비율

// 단어 하나를 감싸는 사각 + 중심 십자선
function createProbe(color) {
  const g = new THREE.Group()

  const rect = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)),
    new THREE.LineBasicMaterial({ color })
  )
  rect.name = 'rect'
  g.add(rect)

  // 중심 십자선 — 어긋남의 방향을 읽기 쉽게
  const cross = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.5, 0, 0),
      new THREE.Vector3(0.5, 0, 0),
      new THREE.Vector3(0, -0.5, 0),
      new THREE.Vector3(0, 0.5, 0),
    ]),
    new THREE.LineBasicMaterial({ color })
  )
  cross.name = 'cross'
  g.add(cross)

  return g
}

// probes: [{ text, u, v, w, h }]
// 반환 객체의 layout(boxWidth, boxHeight)을 호출하면 현재 타겟 크기에 맞춰
// 각 probe의 위치·크기를 갱신한다.
export function createWordProbes(probes, { color = 0x60a5fa } = {}) {
  const group = new THREE.Group()
  group.name = 'word-probes'

  const items = probes.map((p) => {
    const mesh = createProbe(color)
    group.add(mesh)
    return { p, mesh }
  })

  // 타겟 평면 로컬 좌표로 변환한다.
  //   정규화 (u,v)는 좌상단 기준·v는 아래로 증가.
  //   three 평면은 중심 원점·y는 위로 증가 → 아래처럼 뒤집어 매핑한다.
  group.layout = (boxWidth, boxHeight) => {
    for (const { p, mesh } of items) {
      const w = p.w * boxWidth
      const h = p.h * boxHeight
      const cx = (p.u + p.w / 2 - 0.5) * boxWidth
      const cy = (0.5 - (p.v + p.h / 2)) * boxHeight
      mesh.position.set(cx, cy, 0.001) // 살짝 앞으로 → z-fighting 방지
      mesh.scale.set(w, h, 1)
    }
  }

  return group
}
