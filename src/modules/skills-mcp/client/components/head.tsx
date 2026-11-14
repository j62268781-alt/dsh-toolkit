/** Page head. JSX uses the host React instance supplied by the client entry. */
import { PageHeader } from '../../../../client/ui/components/settings-parts/index.jsx'

export const PAGE_TITLE = 'Skills & MCP'
export const PAGE_INTRO = '全局与项目级分层管理；保存后立即生效。'

/** 页头结构交给公共组件，两个字符串仍是本模块自己的文案。 */
export function pageHead() {
  return <PageHeader key="head" title={PAGE_TITLE} subtitle={PAGE_INTRO} />
}