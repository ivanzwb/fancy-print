import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
/** Marks route as anonymous (no device Bearer), e.g. auth exchange. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
