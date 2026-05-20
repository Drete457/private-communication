/**
 * User Session Manager
 * 
 * Manages authenticated WebSocket sessions and user mappings
 */

import WebSocket from 'ws';

import { logger } from '../utils/logger';

import type { ServerWebSocketEvent, ServerWebSocketEventMap } from '../types';

interface UserSession {
  userId: string;
  socket: WebSocket;
  publicKey: string;
  authenticatedAt: number;
}

class SessionManager {
  private sessions = new Map<string, UserSession>();
  private socketToUser = new Map<WebSocket, string>();

  /**
   * Register an authenticated session
   */
  addSession(userId: string, socket: WebSocket, publicKey: string): void {
    // Close any existing session for this user
    const existingSession = this.sessions.get(userId);
    if (existingSession) {
      logger.info('Closing existing session for user', { userId: userId.slice(0, 8) });
      existingSession.socket.close(1000, 'New session opened');
      this.socketToUser.delete(existingSession.socket);
    }

    const session: UserSession = {
      userId,
      socket,
      publicKey,
      authenticatedAt: Date.now()
    };

    this.sessions.set(userId, session);
    this.socketToUser.set(socket, userId);
    
    logger.info('Session registered', { userId: userId.slice(0, 8) });
  }

  /**
   * Remove a session
   */
  removeSession(socket: WebSocket): string | null {
    const userId = this.socketToUser.get(socket);
    if (userId) {
      this.sessions.delete(userId);
      this.socketToUser.delete(socket);
      logger.info('Session removed', { userId: userId.slice(0, 8) });
      return userId;
    }
    return null;
  }

  /**
   * Get a user's socket connection
   */
  getSocket(userId: string): WebSocket | null {
    const session = this.sessions.get(userId);
    return session?.socket ?? null;
  }

  /**
   * Get user ID from socket
   */
  getUserId(socket: WebSocket): string | null {
    return this.socketToUser.get(socket) ?? null;
  }

  /**
   * Check if a user is connected
   */
  isConnected(userId: string): boolean {
    const session = this.sessions.get(userId);
    return session?.socket.readyState === WebSocket.OPEN;
  }

  /**
   * Get all connected user IDs
   */
  getConnectedUsers(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Broadcast to all connected users except sender
   */
  broadcast<Event extends ServerWebSocketEvent>(event: Event, data: ServerWebSocketEventMap[Event], excludeUserId?: string): void {
    const message = JSON.stringify({ event, data, timestamp: Date.now() });
    
    for (const [userId, session] of this.sessions) {
      if (userId !== excludeUserId && session.socket.readyState === WebSocket.OPEN) {
        session.socket.send(message);
      }
    }
  }

  /**
   * Send to a specific user
   */
  sendToUser<Event extends ServerWebSocketEvent>(userId: string, event: Event, data: ServerWebSocketEventMap[Event]): boolean {
    const session = this.sessions.get(userId);
    if (session?.socket.readyState === WebSocket.OPEN) {
      const message = JSON.stringify({ event, data, timestamp: Date.now() });
      session.socket.send(message);
      return true;
    }
    return false;
  }
}

// Singleton instance
export const sessionManager = new SessionManager();
