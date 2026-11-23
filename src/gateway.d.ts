import type { Server } from 'node:http';
import type { Provider, Audience } from './index.js';
export interface Route { destinations: string[]; allow: Audience; retries?: number }
export function createGateway(options: {
  providers: Record<string, Provider>; routes: Record<string, Route>; token: string;
  maxSessions?: number; sessionTTL?: number; maxConcurrent?: number; maxBodyBytes?: number; timeoutMs?: number;
}): Server;
