import {sql} from 'drizzle-orm';
import {database} from '../lib/database';
import type {Bindings} from '../types';
export const defaultNotificationRuntime={push_enabled:true,alarms_enabled:true,newsletter_enabled:true,announcements_enabled:true,campus_updates_enabled:true,email_enabled:true};
export type NotificationRuntime=typeof defaultNotificationRuntime;
export async function notificationRuntime(env:Bindings,institutionId:string|null){const rows=await database(env).execute<NotificationRuntime>(sql`select push_enabled,alarms_enabled,newsletter_enabled,announcements_enabled,campus_updates_enabled,email_enabled from app_private.notification_runtime_controls where scope_key='global' or institution_id=${institutionId}::uuid`);return Object.fromEntries(Object.entries(defaultNotificationRuntime).map(([key,value])=>[key,value&&rows.rows.every(row=>row[key as keyof NotificationRuntime])])) as NotificationRuntime;}
