import { defineConfig } from 'vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

// 카메라 접근은 보안 컨텍스트(HTTPS 또는 localhost)에서만 허용된다.
// 폰으로 LAN에서 접속해 실측하려면 HTTPS가 필수이므로 dev 서버에 자체 서명 인증서를 켠다.
// (실측 시 폰 브라우저에서 인증서 경고를 한 번 수락해야 한다. 배포는 정식 HTTPS로.)
export default defineConfig({
  // GitHub Pages 프로젝트 사이트는 https://<user>.github.io/WebARtest/ 로 서빙된다.
  // 절대 base로 고정해야 끝 슬래시 없는 주소(.../WebARtest)로 열어도 자산 경로가
  // github.io 루트로 새지 않는다. (상대 './'는 끝 슬래시 없을 때 404 → 백지)
  base: '/WebARtest/',
  // 빌드 식별자: 화면에 찍어 "지금 보는 게 새 빌드인가 캐시인가"를 눈으로 구분한다.
  define: {
    __BUILD_ID__: JSON.stringify(new Date().toISOString().slice(11, 19)),
  },
  build: {
    rollupOptions: {
      output: {
        // 자산 파일명에서 해시를 제거해 URL을 고정한다.
        // GitHub Pages는 HTML을 max-age=600(10분) 캐시하므로, 해시가 매 빌드
        // 바뀌면 캐시된 옛 HTML이 이미 삭제된 해시 자산을 가리켜 404 → 백지가 된다.
        // 파일명이 고정이면 옛 HTML을 캐시해도 항상 유효한 최신 자산을 받는다.
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
  plugins: [basicSsl()],
  server: {
    host: true, // 0.0.0.0 바인딩 → 같은 Wi-Fi의 폰에서 접속 가능
    port: 5173,
  },
  preview: {
    host: true,
    port: 4173,
  },
})
