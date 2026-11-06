import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { ZodError } from 'zod';
import { CareerConflict, CareerNotFound } from '../../../packages/career/src/store';
import { CareerStorageError } from '../../../packages/career/src/storage';

/** Conflict codes whose fix is actionable keep a specific Chinese message; the rest stay generic. */
const CONFLICT_MESSAGES: Record<string, string> = {
  SESSION_NOT_READY: '请先在本机浏览器完成登录并通过会话检查，再冻结这批审批。',
  STAGING_EXPIRED: '简历暂存已过期，请重新上传原始文件。',
};

/** Maps career domain and shared-schema errors at the HTTP boundary only for the career controllers,
 *  so unrelated routes keep Nest's default exception behaviour. */
@Catch()
export class CareerErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    if (error instanceof HttpException) {
      response.status(error.getStatus()).json(error.getResponse());
      return;
    }
    if (error instanceof ZodError) {
      response.status(HttpStatus.BAD_REQUEST).json({
        message: error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '),
      });
      return;
    }
    if (error instanceof CareerNotFound) {
      response.status(HttpStatus.NOT_FOUND).json({ message: error.message });
      return;
    }
    if (error instanceof CareerConflict) {
      response.status(HttpStatus.CONFLICT).json({ code: error.code, message: CONFLICT_MESSAGES[error.code] ?? '请求与当前状态冲突，请重新读取后重试。' });
      return;
    }
    if (error instanceof CareerStorageError) {
      response.status(HttpStatus.SERVICE_UNAVAILABLE).json({ code: error.code, message: '本地私有存储不可用，请检查目录权限。' });
      return;
    }
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ message: '服务暂时不可用，请稍后重试。' });
  }
}
