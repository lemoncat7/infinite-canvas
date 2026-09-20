import { type FastifyReply } from "fastify";
import { bootTime } from "../core/config.js";

export const notificationStreams = new Map<FastifyReply["raw"], string>();

export function closeNotificationStreams() {
  for (const stream of notificationStreams.keys()) stream.end();
  notificationStreams.clear();
}

export function sendNotificationSync(stream: FastifyReply["raw"]) {
  if (!stream.destroyed)
    stream.write(
      `event: notifications\ndata: ${JSON.stringify({ updatedAt: new Date().toISOString(), serverVersion: bootTime })}\n\n`,
    );
}

export function broadcastNotificationSync() {
  for (const stream of notificationStreams.keys()) sendNotificationSync(stream);
}

export function onlineUserCount() {
  return new Set(notificationStreams.values()).size;
}

export function sendPresence(stream: FastifyReply["raw"]) {
  if (!stream.destroyed)
    stream.write(
      `event: presence\ndata: ${JSON.stringify({ online: onlineUserCount() })}\n\n`,
    );
}

export function broadcastPresence() {
  for (const stream of notificationStreams.keys()) sendPresence(stream);
}
