export const acceptedDocuments = '.pdf,.docx,.pptx,.png,.jpg,.jpeg,.webp,.bmp';

export function documentFormat(name: string) {
  if (/\.pdf$/i.test(name)) return 'pdf';
  if (/\.docx$/i.test(name)) return 'word';
  if (/\.pptx$/i.test(name)) return 'slides';
  if (/\.(?:png|jpe?g|webp|bmp)$/i.test(name)) return 'image';
  return null;
}

export function documentLocation(file: string, number: number) {
  const format = documentFormat(file);
  return format === 'slides' ? 'Slide '+number : format === 'word' ? 'Section '+number
    : format === 'image' ? 'Image' : 'Page '+number;
}

export function originalDocumentLink(file: string, url: string, number: number) {
  return documentFormat(file)==='pdf' ? url+'#page='+number : url;
}
