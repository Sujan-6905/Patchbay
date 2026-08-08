import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const SERVER_TARGET = 'http://localhost:5001';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/socket.io': { target: SERVER_TARGET, ws: true },
      '/api': { target: SERVER_TARGET },
    },
  },
});
