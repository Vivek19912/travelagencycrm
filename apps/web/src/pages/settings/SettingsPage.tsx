import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, X } from 'lucide-react';
import { SETTINGS_CURRENCIES, SETTINGS_TIMEZONES } from '@interscale/shared';
import { ApiError } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { formatDateTime12Hour } from '@/utils/dateTime';
import { useAuth } from '@/features/auth/AuthProvider';
import { SearchUsagePage } from '@/pages/administration/SearchUsagePage';
import { EmailConfigurationForm } from './EmailConfigurationForm';
import {
  useAddSearchApiKey,
  useRemoveSearchApiKey,
  useSearchApiKeys,
  useTestSearchApiKey,
  useUpdateSearchApiKey,
} from '@/features/search/search.api';
import {
  useCheckCustomDomain,
  useCustomDomain,
  useDeleteCustomDomain,
  useDisableCustomDomain,
  useRemoveLogo,
  useSaveBankAccount,
  useSetUpCustomDomain,
  useSettings,
  useUpdateBranding,
  useUpdateCustomDomain,
  useUpdateDefaultTerms,
  useUpdatePreferences,
  useUpdateProfile,
  useUpdateTax,
  useUploadLogo,
  type CompanySettings,
} from '@/features/settings/settings.api';

const input = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm';
const card = 'rounded-xl border bg-card p-5 shadow-sm space-y-4';

/**
 * UI-only visibility flags. These hide user-facing controls without touching
 * the underlying data/API (reversible later by flipping back to true).
 */
const SHOW_PRIMARY_COLOUR_SETTING = false;
const SHOW_BANK_ACCOUNT_SETTINGS = false;
const SHOW_DEFAULT_TERMS_SETTINGS = false;
/* Timezone is fixed at Asia/Kolkata for every tenant, so the Preferences tab
   (timezone + default currency) is hidden. The API and `PreferencesTab` are
   untouched — flip this back to true to restore the tab. */
const SHOW_PREFERENCES_SETTINGS = false;

const TABS = [
  ['profile', 'Company Profile'],
  ['branding', 'Branding'],
  ['tax', 'Tax'],
  ...(SHOW_PREFERENCES_SETTINGS ? ([['preferences', 'Preferences']] as const) : []),
  ...(SHOW_DEFAULT_TERMS_SETTINGS ? ([['terms', 'Default Terms']] as const) : []),
  ['custom-domain', 'Custom Domain'],
  ...(SHOW_BANK_ACCOUNT_SETTINGS ? ([['bank', 'Bank Account']] as const) : []),
  ['live-search', 'Live Search'],
  ['api-usage', 'API Usage'],
  ['email', 'Email'],
] as const;
type TabKey = (typeof TABS)[number][0];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}

function Feedback({
  error,
  success,
}: {
  error?: string | undefined;
  success?: boolean | undefined;
}) {
  if (error)
    return (
      <p className="text-sm text-red-700" role="alert">
        {error}
      </p>
    );
  if (success) return <p className="text-sm text-emerald-700">Saved.</p>;
  return null;
}

function ProfileTab({ data, canUpdate }: { data: CompanySettings; canUpdate: boolean }) {
  const mutation = useUpdateProfile();
  const [form, setForm] = useState(data.profile);
  useEffect(() => setForm(data.profile), [data.profile]);
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const [operatingSince, setOperatingSince] = useState(
    data.profile.operatingSince?.toString() ?? '',
  );
  const [totalReviews, setTotalReviews] = useState(data.profile.totalReviews?.toString() ?? '');
  const [tripsSold, setTripsSold] = useState(data.profile.tripsSold?.toString() ?? '');
  useEffect(() => {
    setOperatingSince(data.profile.operatingSince?.toString() ?? '');
    setTotalReviews(data.profile.totalReviews?.toString() ?? '');
    setTripsSold(data.profile.tripsSold?.toString() ?? '');
  }, [data.profile.operatingSince, data.profile.totalReviews, data.profile.tripsSold]);
  const intOrNull = (value: string) => (value.trim() === '' ? null : Number(value));
  return (
    <section className={card}>
      <h2 className="font-semibold">Company Profile</h2>
      <Field label="Company name">
        <input
          aria-label="Company name"
          className={input}
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
        />
      </Field>
      <Field label="Email">
        <input
          aria-label="Company email"
          className={input}
          value={form.email}
          onChange={(e) => set('email', e.target.value)}
        />
      </Field>
      <Field label="Phone">
        <input
          aria-label="Company phone"
          className={input}
          value={form.phone ?? ''}
          onChange={(e) => set('phone', e.target.value)}
        />
      </Field>
      <Field label="Website">
        <input
          aria-label="Company website"
          className={input}
          value={form.website ?? ''}
          onChange={(e) => set('website', e.target.value)}
        />
      </Field>
      <Field label="Address">
        <textarea
          aria-label="Company address"
          className={input}
          rows={2}
          value={form.address ?? ''}
          onChange={(e) => set('address', e.target.value)}
        />
      </Field>
      <Field label="Google Maps Link">
        <input
          aria-label="Company Google Maps link"
          className={input}
          placeholder="https://maps.google.com/..."
          value={form.googleMapsUrl ?? ''}
          onChange={(e) => set('googleMapsUrl', e.target.value)}
        />
      </Field>
      <Field label="Operating Since">
        <input
          aria-label="Operating Since"
          type="number"
          min={1900}
          max={2100}
          placeholder="e.g. 2015"
          className={input}
          value={operatingSince}
          onChange={(e) => setOperatingSince(e.target.value)}
        />
      </Field>
      <Field label="Total Reviews">
        <input
          aria-label="Total Reviews"
          type="number"
          min={0}
          className={input}
          value={totalReviews}
          onChange={(e) => setTotalReviews(e.target.value)}
        />
      </Field>
      <Field label="Trips Sold">
        <input
          aria-label="Trips Sold"
          type="number"
          min={0}
          className={input}
          value={tripsSold}
          onChange={(e) => setTripsSold(e.target.value)}
        />
      </Field>
      {canUpdate && (
        <Button
          isLoading={mutation.isPending}
          onClick={() =>
            mutation.mutate({
              name: form.name,
              email: form.email,
              phone: form.phone || null,
              website: form.website || null,
              address: form.address || null,
              googleMapsUrl: form.googleMapsUrl || null,
              operatingSince: intOrNull(operatingSince),
              totalReviews: intOrNull(totalReviews),
              tripsSold: intOrNull(tripsSold),
            })
          }
        >
          Save profile
        </Button>
      )}
      <Feedback error={mutation.error?.message} success={mutation.isSuccess} />
    </section>
  );
}

function BrandingTab({ data, canUpdate }: { data: CompanySettings; canUpdate: boolean }) {
  const branding = useUpdateBranding();
  const upload = useUploadLogo();
  const remove = useRemoveLogo();
  const [color, setColor] = useState(data.branding.primaryColor);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => setColor(data.branding.primaryColor), [data.branding.primaryColor]);
  return (
    <section className={card}>
      <h2 className="font-semibold">Branding</h2>
      {SHOW_PRIMARY_COLOUR_SETTING && (        <>
          <Field label="Primary colour">
            <div className="flex items-center gap-2">
              <input
                aria-label="Primary colour picker"
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-9 w-12 rounded border"
              />
              <input
                aria-label="Primary colour hex"
                className={`${input} max-w-40`}
                value={color}
                onChange={(e) => setColor(e.target.value)}
              />
            </div>
          </Field>
          {canUpdate && (
            <Button
              isLoading={branding.isPending}
              onClick={() => branding.mutate({ primaryColor: color })}
            >
              Save colour
            </Button>
          )}
          <Feedback error={branding.error?.message} success={branding.isSuccess} />
        </>
      )}

      <div className="border-t pt-4">
        <p className="text-sm font-medium text-slate-700">Company logo</p>
        <div className="mt-2 flex h-24 w-40 items-center justify-center overflow-hidden rounded-lg border bg-slate-50">
          {data.branding.hasLogo && data.branding.logoUrl ? (
            <img
              src={data.branding.logoUrl}
              alt="Company logo"
              className="h-full w-full object-contain"
            />
          ) : (
            <span className="text-xs text-slate-400">No logo</span>
          )}
        </div>
        {canUpdate && (
          <div className="mt-3 flex items-center gap-2">
            <input
              ref={fileRef}
              aria-label="Logo file"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="text-sm"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) upload.mutate(file);
              }}
            />
            {data.branding.hasLogo && (
              <Button
                variant="secondary"
                isLoading={remove.isPending}
                onClick={() => remove.mutate()}
              >
                Remove logo
              </Button>
            )}
          </div>
        )}
        {upload.isPending && <p className="mt-1 text-sm text-slate-500">Uploading…</p>}
        <Feedback error={upload.error?.message || remove.error?.message} />
      </div>
    </section>
  );
}

function TaxTab({ data, canUpdate }: { data: CompanySettings; canUpdate: boolean }) {
  const mutation = useUpdateTax();
  const [gstin, setGstin] = useState(data.tax.taxRegistrationNumber ?? '');
  const [tan, setTan] = useState(data.tax.tan ?? '');
  useEffect(() => {
    setGstin(data.tax.taxRegistrationNumber ?? '');
    setTan(data.tax.tan ?? '');
  }, [data.tax.taxRegistrationNumber, data.tax.tan]);
  const errorFields = mutation.error instanceof ApiError ? mutation.error.fields : undefined;
  const fieldError = (key: string) =>
    errorFields?.[key]?.map((message) => (
      <p key={message} role="alert" className="text-sm text-red-700">
        {message}
      </p>
    ));
  return (
    <section className={card}>
      <h2 className="font-semibold">Tax</h2>
      <Field label="GSTIN">
        <input
          aria-label="GSTIN"
          className={input}
          value={gstin}
          onChange={(e) => setGstin(e.target.value)}
        />
        {fieldError('taxRegistrationNumber')}
      </Field>
      <Field label="TAN">
        <input
          aria-label="TAN"
          className={input}
          value={tan}
          onChange={(e) => setTan(e.target.value)}
        />
        {fieldError('tan')}
      </Field>
      <p className="text-xs text-slate-500">
        Printed on Tax Invoices when configured. GST and TCS amounts are still entered per booking —
        this does not enable automatic tax calculation.
      </p>
      {canUpdate && (
        <Button
          isLoading={mutation.isPending}
          onClick={() =>
            mutation.mutate({
              taxRegistrationNumber: gstin || null,
              tan: tan || null,
            })
          }
        >
          Save tax settings
        </Button>
      )}
      <Feedback error={mutation.error?.message} success={mutation.isSuccess} />
    </section>
  );
}

function PreferencesTab({ data, canUpdate }: { data: CompanySettings; canUpdate: boolean }) {
  const mutation = useUpdatePreferences();
  const [timezone, setTimezone] = useState(data.preferences.timezone);
  const [currency, setCurrency] = useState(data.preferences.defaultCurrency);
  useEffect(() => {
    setTimezone(data.preferences.timezone);
    setCurrency(data.preferences.defaultCurrency);
  }, [data.preferences]);
  // Preserve a stored value even if outside the curated list.
  const zones = SETTINGS_TIMEZONES.includes(timezone as (typeof SETTINGS_TIMEZONES)[number])
    ? SETTINGS_TIMEZONES
    : [timezone, ...SETTINGS_TIMEZONES];
  const currencies = SETTINGS_CURRENCIES.includes(currency as (typeof SETTINGS_CURRENCIES)[number])
    ? SETTINGS_CURRENCIES
    : [currency, ...SETTINGS_CURRENCIES];
  return (
    <section className={card}>
      <h2 className="font-semibold">Preferences</h2>
      <Field label="Timezone">
        <select
          aria-label="Timezone"
          className={input}
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
        >
          {zones.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
      </Field>
      <p className="text-xs text-amber-700">
        Changing the timezone affects how future dates are interpreted. Existing timestamps are not
        rewritten.
      </p>
      <Field label="Default currency">
        <select
          aria-label="Default currency"
          className={input}
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
        >
          {currencies.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </Field>
      <p className="text-xs text-slate-500">Applies to newly created records only.</p>
      {canUpdate && (
        <Button
          isLoading={mutation.isPending}
          onClick={() => mutation.mutate({ timezone, defaultCurrency: currency })}
        >
          Save preferences
        </Button>
      )}
      <Feedback error={mutation.error?.message} success={mutation.isSuccess} />
    </section>
  );
}

function TermsTab({ data, canUpdate }: { data: CompanySettings; canUpdate: boolean }) {
  const mutation = useUpdateDefaultTerms();
  const [quotationTerms, setQuotationTerms] = useState(data.defaultTerms.quotationTerms ?? '');
  const [bookingTerms, setBookingTerms] = useState(data.defaultTerms.bookingTerms ?? '');
  useEffect(() => {
    setQuotationTerms(data.defaultTerms.quotationTerms ?? '');
    setBookingTerms(data.defaultTerms.bookingTerms ?? '');
  }, [data.defaultTerms]);
  return (
    <section className={card}>
      <h2 className="font-semibold">Default Terms</h2>
      <p className="text-xs text-slate-500">
        Used only for new records. Existing quotations and bookings are unchanged;
        quotation-converted bookings keep the quotation terms.
      </p>
      <Field label="Default quotation terms">
        <textarea
          aria-label="Default quotation terms"
          className={input}
          rows={4}
          value={quotationTerms}
          onChange={(e) => setQuotationTerms(e.target.value)}
        />
      </Field>
      <Field label="Default booking terms">
        <textarea
          aria-label="Default booking terms"
          className={input}
          rows={4}
          value={bookingTerms}
          onChange={(e) => setBookingTerms(e.target.value)}
        />
      </Field>
      {canUpdate && (
        <Button
          isLoading={mutation.isPending}
          onClick={() =>
            mutation.mutate({
              quotationTerms: quotationTerms || null,
              bookingTerms: bookingTerms || null,
            })
          }
        >
          Save default terms
        </Button>
      )}
      <Feedback error={mutation.error?.message} success={mutation.isSuccess} />
    </section>
  );
}

const emptyBank = {
  accountHolderName: '',
  bankName: '',
  branchName: '',
  accountNumber: '',
  confirmAccountNumber: '',
  ifscCode: '',
  swiftCode: '',
  accountType: '',
};

function BankTab({ data, canUpdate }: { data: CompanySettings; canUpdate: boolean }) {
  const mutation = useSaveBankAccount();
  const [form, setForm] = useState(emptyBank);
  const [mismatch, setMismatch] = useState(false);
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const bank = data.bankAccount;
  return (
    <section className={card}>
      <h2 className="font-semibold">Bank Account</h2>
      {bank.exists && (
        <div className="rounded-lg bg-slate-50 p-3 text-sm">
          <p className="font-medium">{bank.accountHolderName}</p>
          <p className="text-slate-600">
            {bank.bankName}
            {bank.branchName ? ` • ${bank.branchName}` : ''}
          </p>
          <p className="text-slate-600">Account {bank.accountNumberMasked}</p>
          {bank.ifscCode && <p className="text-slate-600">IFSC {bank.ifscCode}</p>}
        </div>
      )}
      {canUpdate && (
        <div className="space-y-3 border-t pt-4">
          <p className="text-sm font-medium">{bank.exists ? 'Replace account' : 'Add account'}</p>
          <Field label="Account holder">
            <input
              aria-label="Account holder"
              className={input}
              value={form.accountHolderName}
              onChange={(e) => set('accountHolderName', e.target.value)}
            />
          </Field>
          <Field label="Bank name">
            <input
              aria-label="Bank name"
              className={input}
              value={form.bankName}
              onChange={(e) => set('bankName', e.target.value)}
            />
          </Field>
          <Field label="Branch name">
            <input
              aria-label="Branch name"
              className={input}
              value={form.branchName}
              onChange={(e) => set('branchName', e.target.value)}
            />
          </Field>
          <Field label="Account number">
            <input
              aria-label="Account number"
              className={input}
              autoComplete="off"
              value={form.accountNumber}
              onChange={(e) => set('accountNumber', e.target.value)}
            />
          </Field>
          <Field label="Confirm account number">
            <input
              aria-label="Confirm account number"
              className={input}
              autoComplete="off"
              value={form.confirmAccountNumber}
              onChange={(e) => set('confirmAccountNumber', e.target.value)}
            />
          </Field>
          <Field label="IFSC code">
            <input
              aria-label="IFSC code"
              className={input}
              value={form.ifscCode}
              onChange={(e) => set('ifscCode', e.target.value)}
            />
          </Field>
          <Field label="SWIFT code">
            <input
              aria-label="SWIFT code"
              className={input}
              value={form.swiftCode}
              onChange={(e) => set('swiftCode', e.target.value)}
            />
          </Field>
          <Field label="Account type">
            <input
              aria-label="Account type"
              className={input}
              value={form.accountType}
              onChange={(e) => set('accountType', e.target.value)}
            />
          </Field>
          {mismatch && (
            <p className="text-sm text-red-700" role="alert">
              Account numbers do not match.
            </p>
          )}
          <Button
            isLoading={mutation.isPending}
            onClick={() => {
              if (form.accountNumber !== form.confirmAccountNumber) {
                setMismatch(true);
                return;
              }
              setMismatch(false);
              mutation.mutate(
                {
                  accountHolderName: form.accountHolderName,
                  bankName: form.bankName,
                  branchName: form.branchName || null,
                  accountNumber: form.accountNumber,
                  confirmAccountNumber: form.confirmAccountNumber,
                  ifscCode: form.ifscCode || null,
                  swiftCode: form.swiftCode || null,
                  accountType: form.accountType || null,
                },
                { onSuccess: () => setForm(emptyBank) },
              );
            }}
          >
            Save bank account
          </Button>
          <Feedback error={mutation.error?.message} success={mutation.isSuccess} />
        </div>
      )}
    </section>
  );
}

function CustomDomainTab({ canUpdate }: { canUpdate: boolean }) {
  const domain = useCustomDomain();
  const setUp = useSetUpCustomDomain();
  const check = useCheckCustomDomain();
  const disable = useDisableCustomDomain();
  const update = useUpdateCustomDomain();
  const remove = useDeleteCustomDomain();
  const [hostname, setHostname] = useState('');
  const [editHostname, setEditHostname] = useState('');
  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const info = domain.data;
  const cnameName = info?.hostname?.split('.')[0] ?? '';

  const statusLabel =
    info?.status === 'ACTIVE'
      ? 'Active'
      : info?.status === 'DISABLED'
        ? 'Disabled'
        : info?.status === 'PENDING'
          ? (info.lastError ?? '').toLowerCase().includes('cname')
            ? 'Waiting for DNS'
            : (info.lastError ?? '').toLowerCase().includes('ssl')
              ? 'SSL Pending'
              : 'Waiting for DNS / SSL Pending'
          : 'Not configured';

  const lastCheckedLabel = info?.lastCheckedAt ? formatDateTime12Hour(info.lastCheckedAt) : null;

  const copy = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1500);
    } catch {
      // Clipboard unavailable — the record is still visible for manual copy.
    }
  };

  return (
    <section className={card}>
      <h2 className="font-semibold">Custom Domain</h2>
      {!info || info.status === 'NONE' ? (
        <>
          <p className="text-sm text-slate-500">
            Use a subdomain such as quotation.yourcompany.com.
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              aria-label="Custom domain hostname"
              className={`${input} max-w-sm`}
              placeholder="quotation.yourcompany.com"
              value={hostname}
              onChange={(event) => setHostname(event.target.value)}
            />
            <Button
              type="button"
              onClick={() => setUp.mutate(hostname)}
              disabled={!canUpdate || setUp.isPending || !hostname.trim()}
            >
              Add Custom Domain
            </Button>
          </div>
          <Feedback error={setUp.error?.message} />
          {setUp.isSuccess && !domain.isLoading && (
            <p className="text-sm text-emerald-600">
              Custom domain setup started. Add the DNS records below.
            </p>
          )}
        </>
      ) : (
        <>
          <dl className="grid gap-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <dt className="text-slate-500">Custom Domain</dt>
              <dd className="flex flex-wrap items-center gap-3">
                <span className="font-medium">{info.hostname}</span>
                {canUpdate && (
                  <>
                    <button
                      type="button"
                      className="text-xs font-semibold text-brand-700 hover:underline"
                      onClick={() => {
                        setEditHostname(info.hostname ?? '');
                        setShowEdit(true);
                      }}
                    >
                      Edit Domain
                    </button>
                    <button
                      type="button"
                      className="text-xs font-semibold text-red-600 hover:underline"
                      onClick={() => setShowDelete(true)}
                    >
                      Delete Domain
                    </button>
                  </>
                )}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Status</dt>
              <dd className="font-medium">{statusLabel}</dd>
            </div>
          </dl>

          <div className="rounded-lg border border-slate-200 p-3 text-sm">
            <p className="font-semibold">DNS Record 1 — CRM CNAME</p>
            <p>Type: CNAME</p>
            <p>Name: {cnameName}</p>
            <div className="flex items-center gap-2">
              <p>Value: {info.cnameTarget}</p>
              <button
                type="button"
                className="text-xs font-semibold text-brand-700"
                onClick={() => copy('cname', info.cnameTarget)}
              >
                {copiedKey === 'cname' ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>

          {info.validationName && info.validationValue && (
            <div className="rounded-lg border border-slate-200 p-3 text-sm">
              <p className="font-semibold">SSL Verification Record</p>
              <p>Type: CNAME</p>
              <p>Name: {info.validationName}</p>
              <div className="flex items-center gap-2">
                <p>Value: {info.validationValue}</p>
                <button
                  type="button"
                  className="text-xs font-semibold text-brand-700"
                  onClick={() => copy('ssl', info.validationValue ?? '')}
                >
                  {copiedKey === 'ssl' ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
          )}

          {info.lastError && <p className="text-sm text-red-600">Error: {info.lastError}</p>}
          {lastCheckedLabel && (
            <p className="text-xs text-slate-500">Last checked: {lastCheckedLabel}</p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => check.mutate()}
              disabled={!canUpdate || check.isPending}
            >
              Check Again
            </Button>
            {info.status === 'ACTIVE' && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => disable.mutate()}
                disabled={!canUpdate || disable.isPending}
              >
                Disable Domain
              </Button>
            )}
          </div>
          <Feedback error={check.error?.message || disable.error?.message} />
        </>
      )}

      {feedback && <p className="text-sm text-emerald-600">{feedback}</p>}

      {showEdit && canUpdate && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Edit Custom Domain"
          onClick={() => setShowEdit(false)}
        >
          <div
            className="w-full max-w-md rounded-xl bg-card shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between rounded-t-xl bg-blue-600 px-5 py-3 text-white">
              <h2 className="text-lg font-semibold">Edit Custom Domain</h2>
              <button
                aria-label="Close edit domain"
                onClick={() => setShowEdit(false)}
                className="rounded p-1 hover:bg-white/20"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-5">
              <p className="text-sm text-slate-600">
                Replace the current custom domain. After saving, the new DNS and SSL records below
                must be configured.
              </p>
              <label className="block text-sm font-medium text-slate-700">
                Domain
                <input
                  aria-label="Edit custom domain hostname"
                  className={`${input} mt-1`}
                  placeholder="quotation.yourcompany.com"
                  value={editHostname}
                  onChange={(event) => setEditHostname(event.target.value)}
                />
              </label>
              {update.error?.message && (
                <div
                  role="alert"
                  className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
                >
                  {update.error.message}
                </div>
              )}
              <div className="flex items-center justify-end gap-2">
                <Button variant="secondary" onClick={() => setShowEdit(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={() =>
                    update.mutate(editHostname, {
                      onSuccess: () => {
                        setShowEdit(false);
                        setFeedback('Custom domain updated. Waiting for DNS / SSL validation.');
                      },
                    })
                  }
                  disabled={update.isPending || !editHostname.trim()}
                >
                  Save Domain
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showDelete && canUpdate && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Delete Custom Domain"
          onClick={() => setShowDelete(false)}
        >
          <div
            className="w-full max-w-md rounded-xl bg-card shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between rounded-t-xl bg-red-600 px-5 py-3 text-white">
              <h2 className="text-lg font-semibold">Delete Custom Domain</h2>
              <button
                aria-label="Close delete domain"
                onClick={() => setShowDelete(false)}
                className="rounded p-1 hover:bg-white/20"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-5">
              <p className="text-sm text-slate-700">
                Remove this custom domain? Your CRM will no longer be accessible through this
                domain.
              </p>
              {remove.error?.message && (
                <div
                  role="alert"
                  className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
                >
                  {remove.error.message}
                </div>
              )}
              <div className="flex items-center justify-end gap-2">
                <Button variant="secondary" onClick={() => setShowDelete(false)}>
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  onClick={() =>
                    remove.mutate(undefined, {
                      onSuccess: () => {
                        setShowDelete(false);
                        setFeedback('Custom domain removed.');
                      },
                    })
                  }
                  disabled={remove.isPending}
                >
                  Delete Domain
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/** Live Search settings: the user's own SearchAPI keys (masked, never returned). */
function LiveSearchKeyTab() {
  const { data: keyData, isLoading } = useSearchApiKeys();
  const add = useAddSearchApiKey();
  const remove = useRemoveSearchApiKey();
  const update = useUpdateSearchApiKey();
  const test = useTestSearchApiKey();
  const [keyInput, setKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error' | 'info'; text: string } | null>(
    null,
  );

  const keys = keyData?.keys ?? [];
  const fallbackAvailable = keyData?.serverFallbackAvailable ?? false;

  const applyMessage = (tone: 'ok' | 'error' | 'info', text: string) => setMessage({ tone, text });

  const onAdd = () => {
    if (!keyInput.trim()) {
      applyMessage('error', 'Enter a SearchAPI API key to add.');
      return;
    }
    add.mutate(keyInput.trim(), {
      onSuccess: () => {
        setKeyInput('');
        setShowKey(false);
        applyMessage('ok', 'API key added.');
      },
      onError: (error) =>
        applyMessage('error', error instanceof Error ? error.message : 'Could not save the key.'),
    });
  };

  const onRemove = (keyId: string) => {
    remove.mutate(keyId, {
      onSuccess: () => applyMessage('ok', 'API key removed.'),
      onError: () => applyMessage('error', 'Could not remove the key.'),
    });
  };

  const onSetStatus = (keyId: string, status: 'ACTIVE' | 'DISABLED') => {
    update.mutate({ keyId, status });
  };

  const onMove = (keyId: string, direction: -1 | 1) => {
    const index = keys.findIndex((key) => key.id === keyId);
    const other = keys[index + direction];
    if (index < 0 || !other) return;
    update.mutate({ keyId, priority: other.priority });
    void update.mutate({ keyId: other.id, priority: keys[index]?.priority ?? other.priority });
  };

  const onTest = () => {
    // Test the typed key if present, otherwise the first saved key.
    test.mutate(keyInput.trim() || null, {
      onSuccess: (result) => {
        if (result.connected) applyMessage('ok', 'API key connected successfully');
        else if (result.reason === 'quota')
          applyMessage('error', 'SearchAPI monthly quota exhausted');
        else if (result.reason === 'unreachable')
          applyMessage('error', 'Could not reach SearchAPI. Check your connection and try again.');
        else if (result.reason === 'error')
          applyMessage('error', 'SearchAPI returned an error for the test request.');
        else applyMessage('error', 'Invalid SearchAPI key');
      },
      onError: () => applyMessage('error', 'Could not test the key.'),
    });
  };

  if (isLoading) return <div className="h-32 animate-pulse rounded-xl bg-card" />;

  const statusLabel: Record<string, string> = {
    ACTIVE: 'Active',
    EXHAUSTED: 'Exhausted',
    INVALID: 'Invalid',
    DISABLED: 'Disabled',
  };
  const statusTone: Record<string, string> = {
    ACTIVE: 'bg-emerald-50 text-emerald-700',
    EXHAUSTED: 'bg-amber-50 text-amber-700',
    INVALID: 'bg-red-50 text-red-700',
    DISABLED: 'bg-slate-100 text-slate-600',
  };

  return (
    <section className={card}>
      <div>
        <h2 className="font-semibold">Live Search</h2>
        {/* <p className="mt-1 text-sm text-slate-600">
          Live hotel &amp; flight search uses SearchAPI. Save one or more SearchAPI API keys;
          searches use your active keys in order and automatically skip an exhausted one. Keys are
          encrypted and never shown back to you.
        </p> */}
      </div>

      <div className="rounded-lg border border-slate-200">
        <div className="flex items-center justify-between px-3 py-2">
          <p className="text-sm font-medium text-slate-800">SearchAPI keys</p>
        </div>
        {keys.length === 0 ? (
          <p className="border-t border-slate-100 px-3 py-3 text-sm text-slate-500">
            No API keys saved.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {keys.map((key, index) => (
              <li
                key={key.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-slate-800">{key.maskedKey}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusTone[key.status] ?? statusTone.ACTIVE}`}
                    >
                      {statusLabel[key.status] ?? key.status}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-400">Priority {index + 1}</p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    aria-label={`Move key ${index + 1} up`}
                    disabled={index === 0}
                    onClick={() => onMove(key.id, -1)}
                    className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Up
                  </button>
                  <button
                    type="button"
                    aria-label={`Move key ${index + 1} down`}
                    disabled={index === keys.length - 1}
                    onClick={() => onMove(key.id, 1)}
                    className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Down
                  </button>
                  {key.status === 'DISABLED' ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => onSetStatus(key.id, 'ACTIVE')}
                    >
                      Enable
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => onSetStatus(key.id, 'DISABLED')}
                    >
                      Disable
                    </Button>
                  )}
                  {(key.status === 'EXHAUSTED' || key.status === 'INVALID') && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => onSetStatus(key.id, 'ACTIVE')}
                    >
                      Reset status
                    </Button>
                  )}
                  <Button size="sm" variant="danger" onClick={() => onRemove(key.id)}>
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-3 border-t pt-4">
        <p className="text-sm font-medium">Add a SearchAPI API key</p>
        <Field label="SearchAPI API Key">
          <div className="relative">
            <input
              aria-label="SearchAPI API key"
              type={showKey ? 'text' : 'password'}
              className={`${input} pr-10`}
              autoComplete="new-password"
              placeholder="sk-…"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
            />
            <button
              type="button"
              aria-label={showKey ? 'Hide key' : 'Show key'}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              onClick={() => setShowKey((v) => !v)}
            >
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </Field>

        {keys.length === 0 && fallbackAvailable && (
          <p className="text-xs text-slate-500">
            No personal keys saved — searches will use the shared server key until you add one.
          </p>
        )}
        {keys.length === 0 && !fallbackAvailable && (
          <p className="text-xs text-amber-700">
            No active SearchAPI key. Add an API key in Settings to use Live Search.
          </p>
        )}

        {message && (
          <div
            className={`rounded-lg px-3 py-2 text-sm ${
              message.tone === 'ok'
                ? 'bg-emerald-50 text-emerald-700'
                : message.tone === 'error'
                  ? 'bg-red-50 text-red-700'
                  : 'bg-slate-50 text-slate-600'
            }`}
          >
            {message.text}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={onAdd} isLoading={add.isPending}>
            Add API key
          </Button>
          <Button size="sm" variant="secondary" onClick={onTest} isLoading={test.isPending}>
            Test connection
          </Button>
        </div>
      </div>
    </section>
  );
}

export function SettingsPage() {
  const settings = useSettings();
  const { isOwner } = useAuth();
  const [tab, setTab] = useState<TabKey>('profile');

  if (settings.isLoading) return <div className="h-96 animate-pulse rounded-xl bg-card" />;
  if (settings.isError || !settings.data)
    return (
      <div role="alert" className="rounded-xl bg-card p-12 text-center text-red-700">
        Settings could not be loaded.
      </div>
    );
  const data = settings.data;
  const canUpdate = data.capabilities.canUpdate;

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-slate-500">Home / Settings</p>
        <h1 className="text-2xl font-semibold">Company Settings</h1>
      </div>
      <nav
        className="flex gap-1 overflow-x-auto rounded-xl border bg-card p-1"
        aria-label="Settings sections"
      >
        {TABS.filter(([key]) => key !== 'api-usage' || isOwner).map(([key, label]) => (
          <button
            key={key}
            className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${
              tab === key ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-50'
            }`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>
      {tab === 'profile' && <ProfileTab data={data} canUpdate={canUpdate} />}
      {tab === 'branding' && <BrandingTab data={data} canUpdate={canUpdate} />}
      {tab === 'tax' && <TaxTab data={data} canUpdate={canUpdate} />}
      {SHOW_PREFERENCES_SETTINGS && tab === 'preferences' && (
        <PreferencesTab data={data} canUpdate={canUpdate} />
      )}
      {SHOW_DEFAULT_TERMS_SETTINGS && tab === 'terms' && (
        <TermsTab data={data} canUpdate={canUpdate} />
      )}
      {tab === 'custom-domain' && <CustomDomainTab canUpdate={canUpdate} />}
      {SHOW_BANK_ACCOUNT_SETTINGS && tab === 'bank' && (
        <BankTab data={data} canUpdate={canUpdate} />
      )}
      {tab === 'live-search' && <LiveSearchKeyTab />}
      {tab === 'api-usage' && isOwner && <SearchUsagePage />}
      {tab === 'email' && <EmailConfigurationForm />}
    </div>
  );
}
