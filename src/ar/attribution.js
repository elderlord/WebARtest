// XR Engine License Agreement §1.3 귀속표시.
// 경로 A(Distributed Engine Binary) 사용 시 필수. 경로 B(MIT)에서는 호출 생략 가능.
//
// §1.3 요건: (i) Niantic Spatial을 Software 제작자로 식별, (ii) 저작권 고지,
//   (iii) 본 Agreement 참조(텍스트 또는 URI/하이퍼링크), (iv) 무보증 고지 참조.
// zip의 resources/powered-by.svg가 귀속 마크다. 벤더링되면 이미지로, 없으면 텍스트로.
const AGREEMENT_URL = 'https://github.com/8thwall/engine/blob/main/LICENSE'

export function showAttribution() {
  if (document.getElementById('xr8-attribution')) return
  const el = document.createElement('div')
  el.id = 'xr8-attribution'
  el.className = 'attribution'
  el.innerHTML = `
    <img class="attribution__logo" src="/xr8/resources/powered-by.svg" alt="Powered by 8th Wall"
         onerror="this.style.display='none';this.nextElementSibling.style.display='inline'" />
    <span class="attribution__fallback" style="display:none">Powered by 8th Wall</span>
    <a class="attribution__link" href="${AGREEMENT_URL}" target="_blank" rel="noopener">
      © Niantic Spatial · XR Engine License · AS-IS, no warranty
    </a>
  `
  document.body.appendChild(el)
  return el
}
