import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { ApiConfig } from '../../../packages/config/src/index';
import { z } from 'zod';

export function signedIdentity(config: ApiConfig) {
  const signature = (value: string) => createHmac('sha256', config.COOKIE_SECRET).update(value).digest('hex');
  return (req: Request, res: Response, next: NextFunction) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin !== config.WEB_ORIGIN) {
      res.status(403).json({ message: 'ORIGIN_REJECTED' }); return;
    }
    const raw = req.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith('interview_identity='))?.slice('interview_identity='.length);
    const [id, expiresText, supplied] = raw?.split('.') ?? [];
    const expires = Number(expiresText);
    const expected = id && expiresText ? signature(`${id}.${expiresText}`) : '';
    let owner: string;
    if (id && z.uuid().safeParse(id).success && Number.isFinite(expires)&&expires > Date.now() && supplied && /^[0-9a-f]{64}$/.test(supplied) && timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
      owner = id;
      if(expires<Date.now()+14*86400000){const value=`${owner}.${Date.now()+30*86400000}`;res.cookie('interview_identity',`${value}.${signature(value)}`,{httpOnly:true,sameSite:'strict',secure:config.NODE_ENV==='production',maxAge:30*86400000,path:'/'});}
    } else {
      owner = randomUUID();
      const value = `${owner}.${Date.now() + 30 * 86400000}`;
      res.cookie('interview_identity', `${value}.${signature(value)}`, { httpOnly: true, sameSite: 'strict', secure: config.NODE_ENV === 'production', maxAge: 30 * 86400000, path: '/' });
    }
    req.headers['x-owner-id'] = owner;
    res.setHeader('Cache-Control', 'no-store');
    next();
  };
}
