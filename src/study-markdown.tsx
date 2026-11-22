import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

export default function StudyMarkdown({text}:{text:string}) {
  return <div className="coach-answer"><Markdown skipHtml remarkPlugins={[remarkGfm,remarkMath]}
    rehypePlugins={[rehypeKatex]} components={{
      img:()=>null,
      table:({children})=><div className="answer-table" role="region" aria-label="Answer table" tabIndex={0}><table>{children}</table></div>
    }}>{text}</Markdown></div>;
}
