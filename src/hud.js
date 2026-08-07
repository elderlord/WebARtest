// 0단계 계측 판독용 HUD.
// 문서 §5 0단계 측정 항목을 화면에서 바로 읽을 수 있게 노출한다:
//   - 인식 성공/실패 상태 (최대 거리·최대 기울기 판정 시 이 지시등이 꺼지는 지점을 기록)
//   - 카메라-타겟 거리 (cm)
//   - 정지 상태 지터 폭 (최근 프레임 위치 표준편차, mm)
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
      <span class="hud__metric">지터 <b id="hud-jitter">–</b></span>
      <span class="hud__metric">FPS <b id="hud-fps">–</b></span>
    </div>
  `
  document.body.appendChild(root)

  const el = {
    dot: root.querySelector('#hud-dot'),
    state: root.querySelector('#hud-state'),
    dist: root.querySelector('#hud-dist'),
    tilt: root.querySelector('#hud-tilt'),
    jitter: root.querySelector('#hud-jitter'),
    fps: root.querySelector('#hud-fps'),
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
    setMetrics({ distanceCm, tiltDeg, jitterMm }) {
      if (distanceCm != null) el.dist.textContent = `${distanceCm.toFixed(0)} cm`
      if (tiltDeg != null) el.tilt.textContent = `${tiltDeg.toFixed(0)}°`
      if (jitterMm != null) el.jitter.textContent = `${jitterMm.toFixed(1)} mm`
    },
    setFps(fps) {
      el.fps.textContent = String(Math.round(fps))
    },
  }
}

export function showBanner(html) {
  const b = document.createElement('div')
  b.className = 'hud__banner'
  b.innerHTML = html
  document.body.appendChild(b)
  return b
}
