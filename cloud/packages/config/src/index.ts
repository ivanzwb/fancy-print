import { z } from 'zod';

/** 云端进程共享的基础环境变量（按需扩展） */
export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export type BaseEnv = z.infer<typeof baseEnvSchema>;

export function parseBaseEnv(env: NodeJS.ProcessEnv): BaseEnv {
  return baseEnvSchema.parse(env);
}
