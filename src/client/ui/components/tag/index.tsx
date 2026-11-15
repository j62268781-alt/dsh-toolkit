/**
 * 行内小标签（药丸）：卡片的来源、作用域、数量都靠它。
 *
 * 这套设置页原来有 `.jdg-tag`（决策）和 `.smp-tag`（skills & mcp）两份同值样式，
 * 钩子面板的计数又手抄了一份，于是同一颗药丸有三处实现、四套色档。现在只剩这里：
 * 组件负责结构（`span` + `data-tone`），量值与四档语气在 settings-parts 的 `.sk-ui-tag`。
 */
export interface TagProps {
  /** 语气档位：neutral（默认）/ ok / warn / danger */
  tone?: string;
  className?: string;
  children?: any;
  [key: string]: any;
}

export function Tag({ tone = "neutral", className, children, ...rest }: TagProps) {
  const merged = className === undefined ? "sk-ui-tag" : `sk-ui-tag ${className}`;
  return <span className={merged} data-tone={tone} {...rest}>{children}</span>;
}
