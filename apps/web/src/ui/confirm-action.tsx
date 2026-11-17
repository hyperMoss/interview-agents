import { cloneElement, useState, type MouseEvent, type ReactElement, type ReactNode } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Layout, LayoutContent, LayoutFooter } from '@astryxdesign/core/Layout';

export type ConfirmActionProps = {
  /** 确认框标题；同时作为对话框的可访问名称。 */
  title: ReactNode;
  /** 确认框副标题，说明操作后果。 */
  description?: ReactNode;
  /** 确认后的实际操作。抛错时对话框保持打开并显示错误，错误不会被吞掉。 */
  onConfirm: () => void | Promise<unknown>;
  /** 触发确认框的控件，通常是按钮。 */
  children: ReactElement<TriggerProps>;
  okText?: string;
  cancelText?: string;
  confirmVariant?: 'primary' | 'destructive';
  /** 触发控件不可用时不打开确认框。 */
  disabled?: boolean;
};

type TriggerProps = { onClick?: (event: MouseEvent<HTMLElement>) => void };

/**
 * 危险或不可撤回操作的确认框：
 * 无弹层层级冲突，确认期间锁定关闭途径，异步失败会留在对话框内显示原因。
 */
export function ConfirmAction({ title, description, onConfirm, children, okText = '确认', cancelText = '取消', confirmVariant = 'destructive', disabled = false }: ConfirmActionProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState('');

  function open() {
    if (disabled) return;
    setError('');
    setIsOpen(true);
  }

  function close() {
    if (isPending) return;
    setIsOpen(false);
    setError('');
  }

  async function confirm() {
    if (isPending) return;
    setIsPending(true);
    setError('');
    try {
      await onConfirm();
      setIsOpen(false);
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : '操作未完成，请重试。');
    } finally {
      setIsPending(false);
    }
  }

  const trigger = cloneElement(children, {
    onClick: (event: MouseEvent<HTMLElement>) => {
      children.props.onClick?.(event);
      if (!event.defaultPrevented) open();
    },
  });

  return <>
    {trigger}
    <Dialog isOpen={isOpen} onOpenChange={next => { if (!next) close(); }} purpose="form" width={440}>
      <Layout
        header={<DialogHeader title={title} onOpenChange={isPending ? undefined : close} />}
        content={<LayoutContent>
          {description ? <div className="confirm-action-content">{description}</div> : null}
          {error ? <p className="confirm-action-error" role="alert">{error}</p> : null}
        </LayoutContent>}
        footer={<LayoutFooter hasDivider>
          <div className="confirm-action-actions">
            <Button label={cancelText} isDisabled={isPending} onClick={close} />
            <Button label={okText} variant={confirmVariant} isLoading={isPending} isDisabled={isPending} onClick={() => void confirm()} />
          </div>
        </LayoutFooter>}
      />
    </Dialog>
  </>;
}
