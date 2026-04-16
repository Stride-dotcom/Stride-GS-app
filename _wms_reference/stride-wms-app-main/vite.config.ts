import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { execSync } from "child_process";

function getGitCommitHash(): string {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return "";
  }
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  define: {
    __BUILD_TIMESTAMP__: JSON.stringify(new Date().toISOString()),
    __COMMIT_HASH__: JSON.stringify(getGitCommitHash()),
  },
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Pin compose-refs to 1.1.1 to fix recursive setRef infinite loop in newer versions
      "@radix-ui/react-compose-refs": path.resolve(__dirname, "node_modules/@radix-ui/react-compose-refs"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "@radix-ui/react-compose-refs"],
  },
  optimizeDeps: {
    include: ["@tanstack/react-query", "@radix-ui/react-compose-refs"],
    force: true,
  },
}));
