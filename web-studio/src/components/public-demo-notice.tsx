import { useTranslation } from 'react-i18next'

export function PublicDemoNotice() {
  const { t } = useTranslation('appShell')
  return (
    <div
      role="status"
      className="rounded-lg border border-border bg-muted/50 px-4 py-3 text-sm"
    >
      <p className="font-medium">{t('publicDemo.title')}</p>
      <p className="mt-1 text-muted-foreground">
        {t('publicDemo.description')}
      </p>
    </div>
  )
}
