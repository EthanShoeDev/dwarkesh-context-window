import { Link } from '@tanstack/react-router';
import parse, {
  attributesToProps,
  domToReact,
  Element,
  type HTMLReactParserOptions,
} from 'html-react-parser';
import * as React from 'react';

import { renderMarkdown } from '@/utils/markdown';

type MarkdownProps = {
  content: string;
  className?: string;
};

export function Markdown({ content, className }: MarkdownProps) {
  const { markup } = React.useMemo(() => renderMarkdown(content), [content]);

  const options: HTMLReactParserOptions = {
    replace: (domNode) => {
      if (!(domNode instanceof Element)) return;

      if (domNode.name === 'a') {
        const href = domNode.attribs.href;
        if (href?.startsWith('/')) {
          return (
            <Link to={href} {...(attributesToProps(domNode.attribs) as any)}>
              {domToReact(domNode.children as any, options)}
            </Link>
          );
        }
      }
    },
  };

  return <div className={className}>{parse(markup, options)}</div>;
}
