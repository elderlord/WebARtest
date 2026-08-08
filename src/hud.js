// 0단계 계측 판독용 HUD.
// 문서 §5 0단계 측정 항목을 화면에서 바로 읽을 수 있게 노출한다:
//   - 인식 성공/실패 상태 (최대 거리·최대 기울기 판정 시 이 지시등이 꺼지는 지점을 기록)
//   - 카메라-타겟 거리 (cm)
//   - Pose 변동 폭 (최근 프레임 위치 표준편차, mm)
//     ※ 스펙 §6.1: 이 값은 손떨림+카메라이동+pose노이즈의 합이다. "tracking
//       precision"으로 오해석 금지. 엔진 정밀도는 클램프 고정 별도 프로토콜로 측정.
export function createHud() {
  const root = document.createElement('div')
  root.className = 'hud'
  root.innerHTML = `
    <div class="hud__row">
      <span class="hud__dot" id="hud-dot"></span>
      <span id="hud-state">타겟 탐색 중…</span>
    </div>
    <div class="hud__row hud__metrics">
      <span class="hud__metric">거리 <b id="hud-dist">–</b></span>
      <span class="hud__metric">기울기 <b id="hud-tilt">–</b></span>
      <span class="hud__metric">Pose 변동 <b id="hud-jitter">–</b></span>
      <span class="hud__metric">FPS <b id="hud-fps">–</b></span>
      <span class="hud__metric">최대인식 <b id="hud-maxdist">–</b></span>
      <span class="hud__metric">재획득 <b id="hud-reacq">0</b></span>
    </div>
    <div class="hud__row hud__debug" id="hud-debug">raw –</div>
  `
  document.body.appendChild(root)

  const el = {
    dot: root.querySelector('#hud-dot'),
    state: root.querySelector('#hud-state'),
    dist: root.querySelector('#hud-dist'),
    tilt: root.querySelector('#hud-tilt'),
    jitter: root.querySelector('#hud-jitter'),
    fps: root.querySelector('#hud-fps'),
    debug: root.querySelector('#hud-debug'),
    maxdist: root.querySelector('#hud-maxdist'),
    reacq: root.querySelector('#hud-reacq'),
  }

  return {
    setFound(found) {
      el.dot.classList.toggle('hud__dot--found', found)
      el.state.textContent = found ? '타겟 인식됨 · 정합 박스 표시' : '타겟 탐색 중…'
      if (!found) {
        el.dist.textContent = '–'
        el.tilt.textContent = '–'
        el.jitter.textContent = '–'
      }
    },
    setMetrics({ distanceCm, tiltDeg, poseVarMm }) {
      if (distanceCm != null) el.dist.textContent = `${distanceCm.toFixed(0)} cm`
      if (tiltDeg != null) el.tilt.textContent = `${tiltDeg.toFixed(0)}°`
      if (poseVarMm != null) el.jitter.textContent = `${poseVarMm.toFixed(1)} mm`
    },
    setFps(fps) {
      el.fps.textContent = String(Math.round(fps))
    },
    // 엔진 원시값 표시 — 좌표/스케일 규약을 눈으로 확정하기 위한 진단용
    setDebug(text) {
      el.debug.textContent = text
    },
    // 0-B 측정: 인식에 성공한 최대 거리(peak hold)와 재획득 횟수
    setMaxDistance(cm) {
      el.maxdist.textContent = cm > 0 ? `${cm.toFixed(0)} cm` : '–'
    },
    setReacquire(n) {
      el.reacq.textContent = String(n)
    },
  }
}

// 박스 크기 미세조정 바 — 정합 배율(k)을 화면에서 직접 맞춰 수치를 읽는다.
// 엔진의 크기 규약이 후보 공식과 정확히 맞지 않아(0-B 실측), 실물에 맞춘 k를
// 읽어 공식을 확정하기 위한 도구.
export function createSizeTuner({ onChange, initial = 1 }) {
  let k = initial
  const bar = document.createElement('div')
  bar.className = 'tuner'
  bar.innerHTML = `
    <button class="tuner__btn" data-d="-0.05">−5%</button>
    <button class="tuner__btn" data-d="-0.01">−1%</button>
    <span class="tuner__val">k <b id="tuner-k">1.000</b></span>
    <button class="tuner__btn" data-d="0.01">+1%</button>
    <button class="tuner__btn" data-d="0.05">+5%</button>
  `
  document.body.appendChild(bar)
  const out = bar.querySelector('#tuner-k')
  bar.addEventListener('click', (e) => {
    const d = e.target && e.target.dataset && e.target.dataset.d
    if (!d) return
    k = Math.max(0.2, Math.min(3, k + parseFloat(d)))
    out.textContent = k.toFixed(3)
    onChange && onChange(k)
  })
  return { get value() { return k } }
}

export function showBanner(html) {
  // 배너가 여러 개일 때 같은 자리에 겹치지 않도록 컨테이너에 세로로 쌓는다.
  let stack = document.getElementById('banner-stack')
  if (!stack) {
    stack = document.createElement('div')
    stack.id = 'banner-stack'
    stack.className = 'banner-stack'
    document.body.appendChild(stack)
  }
  const b = document.createElement('div')
  b.className = 'hud__banner hud__banner--stacked'
  b.innerHTML = html
  stack.appendChild(b)
  return b
}
