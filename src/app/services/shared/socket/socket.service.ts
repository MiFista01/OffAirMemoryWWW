import { Injectable } from '@angular/core';
import { io, Socket } from 'socket.io-client';

/**
 * Socket service for WebSocket connection management with multiple connection support.
 * 
 * WebSocket management service featuring multiple socket connection handling with
 * connection state tracking, message sending and receiving capabilities, and
 * connection lifecycle management. Includes automatic connection prevention for
 * existing connections, error handling for connection failures, and support for
 * query parameters. Provides centralized WebSocket communication for real-time
 * features with proper connection cleanup and event management.
 */
@Injectable({
  providedIn: 'root'
})
export class SocketService {
  private sockets: Map<string, Socket> = new Map();
  private callbacks: Map<string, Map<string, Array<(...args: any[]) => void>>> = new Map();
  /** Re-emit join payloads after every connect (incl. reconnect). */
  private onConnectHooks: Map<string, Array<() => void>> = new Map();

  setConnection(url: string, queryParams?: Record<string, string>) {
    if (this.sockets.has(url)) {
      const existingSocket = this.sockets.get(url);
      if (existingSocket?.connected) {
        // Called on every seam-sync — stay quiet (Chrome was stacking ×80+).
        return;
      } else {
        console.log('⚠️ [SocketService] Socket exists but disconnected, reconnecting...');
        existingSocket?.connect();
        return;
      }
    }

    const socket = io(url, {
      query: queryParams,
      // Polling first — more reliable behind reverse proxies; then upgrade.
      transports: ['polling', 'websocket'],
      upgrade: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 12_000,
      timeout: 20_000,
    });

    let lastErrLog = 0;
    socket.on('connect_error', (err) => {
      const now = Date.now();
      if (now - lastErrLog < 30_000) return;
      lastErrLog = now;
      console.warn(`[SocketService] connect_error ${url}: ${err?.message ?? err}`);
    });
    socket.on('connect', () => {
      console.log(`Connected to ${url}`);
      for (const hook of this.onConnectHooks.get(url) ?? []) {
        try {
          hook();
        } catch {
          /* ignore */
        }
      }
    });
    socket.on('disconnect', (reason) => {
      // Transport close / ping timeout — socket.io will reconnect; do not escalate TV.
      if (reason === 'io server disconnect') {
        socket.connect();
      }
    });

    this.sockets.set(url, socket);
  }

  /** Register a callback that runs on every connect/reconnect for this URL. */
  onConnect(url: string, cb: () => void): () => void {
    const list = this.onConnectHooks.get(url) ?? [];
    list.push(cb);
    this.onConnectHooks.set(url, list);
    return () => {
      const cur = this.onConnectHooks.get(url) ?? [];
      this.onConnectHooks.set(
        url,
        cur.filter((x) => x !== cb),
      );
    };
  }

  killConnect(url: string) {
    const socket = this.sockets.get(url);
    if (socket) {
      socket.disconnect();
      socket.removeAllListeners();
      this.sockets.delete(url);
      this.callbacks.delete(url);
      this.onConnectHooks.delete(url);
    }
  }

  killAllConnections() {
    this.sockets.forEach(socket => {
      socket.disconnect();
      socket.removeAllListeners();
    });
    this.sockets.clear();
    this.callbacks.clear();
    this.onConnectHooks.clear();
  }

  sendMessage(url: string, eventName: string, data?: any): boolean {
    const socket = this.sockets.get(url);
  
    if (!socket) {
      console.error(`❌ [SocketService] Socket not found: ${url}`);
      console.log('  Available sockets:', Array.from(this.sockets.keys()));
      return false;
    }
  
    if (socket.connected) {
      socket.emit(eventName, data);
      return true;
    }
    
    console.warn(`⚠️ [SocketService] Socket not connected: ${url}, attempting to connect...`);
    socket.connect();
    
    socket.once('connect', () => {
      socket.emit(eventName, data);
    });
    
    return false;
  }

  onMessage(
    url: string,
    eventName: string,
    callback: (message: any) => void
  ): () => void {
    const socket = this.sockets.get(url);
    
    if (!socket) {
      console.error(`❌ [SocketService] Socket not found: ${url}`);
      return () => {};
    }

    if (!this.callbacks.has(url)) {
      this.callbacks.set(url, new Map());
    }
    
    const callbacks = this.callbacks.get(url)!;
    
    if (!callbacks.has(eventName)) {
      callbacks.set(eventName, []);
    }
    
    const eventCallbacks = callbacks.get(eventName)!;
    
    if (eventCallbacks.includes(callback)) {
      console.warn(`[SocketService] Callback already registered for ${url}:${eventName}`);
      return () => {
        const index = eventCallbacks.indexOf(callback);
        if (index > -1) {
          socket.off(eventName, callback);
          eventCallbacks.splice(index, 1);
          if (eventCallbacks.length === 0) {
            callbacks.delete(eventName);
          }
        }
      };
    }
    
    eventCallbacks.push(callback);
    socket.on(eventName, callback);
    
    return () => {
      socket.off(eventName, callback);
      const index = eventCallbacks.indexOf(callback);
      if (index > -1) {
        eventCallbacks.splice(index, 1);
        if (eventCallbacks.length === 0) {
          callbacks.delete(eventName);
        }
      }
    };
  }
}