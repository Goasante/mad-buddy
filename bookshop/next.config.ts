import type { NextConfig } from "next";
const nextConfig:NextConfig={turbopack:{root:process.cwd()},async headers(){return [{source:"/:path*",headers:[{key:"X-Content-Type-Options",value:"nosniff"},{key:"X-Frame-Options",value:"DENY"},{key:"Referrer-Policy",value:"strict-origin-when-cross-origin"}]},{source:"/books/ma-prospecting-playbook/access",headers:[{key:"Cache-Control",value:"private, no-store, max-age=0"},{key:"Referrer-Policy",value:"no-referrer"}]}];}};
export default nextConfig;
