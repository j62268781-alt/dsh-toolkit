/**
 * 设置面板的公共骨架：页头、卡片组、行、宫格。
 *
 * 九个面板原先各写一份 h2/p/卡片/行，量值全靠手抄（改一处漏三处）。这里的数
 * 直接对齐内置插件页（`dsh-client-ui-settings-plugins` 的 `PluginsSettingsSection`）：
 * 标题 18/600、副标题 13px 三级文字色、与标题 12px；卡片 0.5px 描边 + 12px 圆角 +
 * 左右 16px；行上下 16px、行间 0.5px 分隔线、右侧控件最宽 55%。
 *
 * 组件只负责结构：控件的字色、宽高仍由各模块自己的 CSS 决定，避免把开关、下拉、
 * 按钮的形状也一起「统一」掉。
 */

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  /** 右侧动作（刷新、全部展开之类）。 */
  actions?: any;
  className?: string;
  [key: string]: any;
}

export function PageHeader(props: PageHeaderProps) {
  const { title, subtitle, actions, className, ...rest } = props;
  return (
    <header className={joinClass("sk-ui-pageHead", className)} {...rest}>
      <div className="sk-ui-pageHeadText">
        <h2 className="sk-ui-pageTitle">{title}</h2>
        {subtitle === undefined || subtitle === "" ? null : <p className="sk-ui-pageIntro">{subtitle}</p>}
      </div>
      {actions === undefined || actions === null ? null : actions}
    </header>
  );
}

export interface CardSectionProps {
  title?: string;
  /** 标题右侧的小字（数量、提示）。 */
  hint?: any;
  /**
   * 只给标题、不加卡片外壳：宫格里的卡片自己带边框时用（外观页、启动动画页），
   * 否则会出现「卡片里再套一层卡片」。
   */
  bare?: boolean;
  className?: string;
  cardClassName?: string;
  children?: any;
  [key: string]: any;
}

/** 标题 + 卡片外壳；标题可省，省掉时只渲染卡片（如「最近执行」那张）。 */
export function CardSection(props: CardSectionProps) {
  const { title, hint, bare = false, className, cardClassName, children, ...rest } = props;
  const heading = title === undefined && hint === undefined ? null : (
    <div className="sk-ui-cardTitleRow">
      {title === undefined ? null : <h3 className="sk-ui-cardTitle">{title}</h3>}
      {hint === undefined || hint === null ? null : <span className="sk-ui-cardHint">{hint}</span>}
    </div>
  );
  return (
    <section className={joinClass("sk-ui-cardSection", className)} {...rest}>
      {heading}
      {bare ? children : <div className={joinClass("sk-ui-card", cardClassName)}>{children}</div>}
    </section>
  );
}

export interface RowProps {
  title?: any;
  description?: any;
  /** 右侧控件；与 `children` 二选一，两个都给时 `children` 追加在控件后。 */
  control?: any;
  className?: string;
  textClassName?: string;
  controlClassName?: string;
  children?: any;
  [key: string]: any;
}

export function Row(props: RowProps) {
  const { title, description, control, className, textClassName, controlClassName, children, ...rest } = props;
  const right = control === undefined && children === undefined
    ? null
    : (
      <div className={joinClass("sk-ui-rowControl", controlClassName)}>
        {control}
        {children}
      </div>
    );
  return (
    <div className={joinClass("sk-ui-row", className)} {...rest}>
      <div className={joinClass("sk-ui-rowText", textClassName)}>
        {title === undefined || title === null ? null : <div className="sk-ui-rowTitle">{title}</div>}
        {description === undefined || description === null || description === "" ? null : (
          <p className="sk-ui-rowDesc">{description}</p>
        )}
      </div>
      {right}
    </div>
  );
}

export interface OptionGridProps {
  columns?: 2 | 3 | 4 | 6;
  className?: string;
  children?: any;
  [key: string]: any;
}

/** 可点选的宫格（启动动画、外观配色、宠物库都靠它）。 */
export function OptionGrid(props: OptionGridProps) {
  const { columns = 3, className, children, ...rest } = props;
  return (
    <div className={joinClass("sk-ui-grid", className)} data-columns={String(columns)} {...rest}>
      {children}
    </div>
  );
}

function joinClass(base: string, extra?: string): string {
  return extra === undefined || extra === "" ? base : `${base} ${extra}`;
}