import { Chevron } from '../components/chevron.jsx'
import { detailNodes } from '../components/card.jsx'

/**
 * What the list card reads. The panel builds every value here (elements, pairs,
 * handlers), so they stay opaque on purpose — this type only has to keep the
 * caller's object literal and this view in step.
 */
export interface ListCardProps {
  key: any
  identity: any
  description?: any
  enabled?: any
  details: any
  pending?: any
  statusNode?: any
  authNote?: any
  isOpen?: any
  onToggle?: any
  menu?: any
  error?: any
  /**
   * Accepted but unused: the panel's `card()` builds `menu` from this same list and
   * passes it along. Declared so the caller's literal stays exact.
   */
  menuItems?: any
}

export function listCardView({ key, identity, description, enabled, details, pending, statusNode, authNote, isOpen, onToggle, menu, error }: ListCardProps) {
  return (
    <li className="smp-card" key={key}>
      <div className="smp-cardRow" key="row">
        <div className="smp-cardMain" key="main">
          <div className="smp-cardHead" key="head">
            <button
              className="smp-cardToggle"
              key="toggle"
              aria-expanded={isOpen}
              onClick={onToggle}
            >
              <Chevron key="c" open={isOpen} />
              <span className="smp-cardIdentity" key="id">{identity}</span>
            </button>
            <span className="smp-cardEnd" key="end">
              {/* 停用时状态整组不渲染：一个已停用的条目没有状态可报，留一个过期的
                  标签会撒谎。「已停用」本身就由右边的开关表达。 */}
              {enabled === false ? null : statusNode ?? null}
            </span>
          </div>
          {description ? <div className="smp-cardDescription" key="desc">{description}</div> : null}
        </div>
        {pending ? (
          <span className="smp-cardActions" key="pending">
            <span className="smp-pending" key="p">
              <span className="smp-spinner" key="s" />{pending}
            </span>
          </span>
        ) : (
          <span className="smp-cardActions" key="actions">

            {menu}
          </span>
        )}
      </div>
      {isOpen ? (
        <div className="smp-cardDetails" key="details">
          <div className="smp-details" key="grid">{detailNodes(details, 'k')}</div>
          {authNote ?? null}
          {error ? <div className="smp-error" key="err" style={{ marginTop: 8 }}>{error}</div> : null}
        </div>
      ) : null}
    </li>
  )
}
