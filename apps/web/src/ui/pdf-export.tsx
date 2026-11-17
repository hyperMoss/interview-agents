import { Button } from '@astryxdesign/core/Button';
import { useMutation } from '@tanstack/react-query';

export function PdfExport({ generate, isDisabled = false }: { generate: () => Promise<{ filename: string; body: Blob }>; isDisabled?: boolean }) {
  const exportPdf = useMutation({ mutationFn: async () => {
    const file = await generate();
    const url = URL.createObjectURL(file.body);
    const link = document.createElement('a');
    link.href = url; link.download = file.filename; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  } });
  return <div className="pdf-export">
    <Button label="导出 PDF" isLoading={exportPdf.isPending} isDisabled={isDisabled || exportPdf.isPending} onClick={() => exportPdf.mutate()} />
    {exportPdf.error ? <p role="alert" className="error">{exportPdf.error.message}</p> : null}
  </div>;
}
