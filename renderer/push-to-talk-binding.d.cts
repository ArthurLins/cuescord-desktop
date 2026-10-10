export const scanCodes: Record<string, number>;
export const virtualKeys: Record<string, number>;
export const mouseKeys: Record<string, number>;
export function validPushToTalkShortcut(code: unknown): code is string;
export function mouseShortcut(button: number): string | undefined;
export function formatPushToTalkShortcut(code: string, locale?: string): string;
