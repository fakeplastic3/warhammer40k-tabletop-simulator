import type { NextConfig } from "next";
const config: NextConfig = {
  transpilePackages: ["@tabletop/shared", "@tabletop/game-data"],
};
export default config;
