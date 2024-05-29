import path from "path";
const env = path.join(process.cwd(), "config", ".env");
import { config } from "dotenv";
config({ path: env }); // , debug: false 
process.env.TSX_TSCONFIG_PATH = path.join(process.cwd(), "OpenFlow", "tsconfig.json");

// import tsNode from "ts-node";
// tsNode.register({
//     files: true,
//     transpileOnly: true,
//     project: "./OpenFlow/tsconfig.json"
// });