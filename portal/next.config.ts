import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async redirects(){return[{source:"/agents/:path*",has:[{type:"host" as const,value:"agents.kampusone.app"}],destination:"https://kampusone.app/agents/:path*",permanent:true}];},
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination:
          (process.env.KAMPUSONE_API_ORIGIN ??
            "https://platformp.divine-haze-54eb.workers.dev") + "/:path*",
      },
    ];
  },
  transpilePackages: ["@kampusone/design-tokens"],
  turbopack: {
    root: path.resolve(process.cwd(), ".."),
  },
};

export default nextConfig;
