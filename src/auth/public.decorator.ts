import { SetMetadata } from '@nestjs/common';
import { PUBLIC_KEY } from './jwt.guard';
export const Public = () => SetMetadata(PUBLIC_KEY, true);
