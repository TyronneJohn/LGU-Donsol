import Breadcrumbs from './Breadcrumbs'

export default function PageHeader({ title, description, breadcrumbs, actions }) {
  return (
    <div className="mb-6 space-y-2">
      {breadcrumbs ? <Breadcrumbs items={breadcrumbs} /> : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight text-slate-800 sm:text-2xl">
            {title}
          </h1>
          {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  )
}
