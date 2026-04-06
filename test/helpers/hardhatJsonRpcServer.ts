import { network } from "hardhat";
import http from "http";

/**
 * Exposes the Hardhat in-process network as a JSON-RPC HTTP server.
 * Allows SDK classes (ZkapFactoryBuilder, ZkapCreator, etc.) to connect via JsonRpcProvider.
 *
 * Usage:
 *   const server = await startHardhatJsonRpcServer(8545);
 *   // ... use SDK classes ...
 *   server.close();
 */
export function startHardhatJsonRpcServer(port: number = 8545): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      // health check endpoint
      if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }

      let body = "";
      req.on("data", (chunk: string) => (body += chunk));
      req.on("end", async () => {
        try {
          const jsonReq = JSON.parse(body);
          const result = await network.provider.send(jsonReq.method, jsonReq.params || []);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ jsonrpc: "2.0", id: jsonReq.id, result }));
        } catch (err: any) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              error: { code: -32000, message: err.message },
            }),
          );
        }
      });
    });

    server.on("error", reject);
    server.listen(port, () => resolve(server));
  });
}
