import {
  Bell,
  BellRing,
  Bookmark,
  Building2,
  BusFront,
  CalendarClock,
  ChartNoAxesCombined,
  Clock,
  Database,
  FileStack,
  FileText,
  Globe2,
  History,
  Hotel,
  KeyRound,
  Landmark,
  LayoutDashboard,
  Mail,
  MapPin,
  MessageSquare,
  NotebookText,
  PackagePlus,
  Plane,
  ReceiptText,
  Search,
  Settings,
  Settings2,
  ShieldCheck,
  Ship,
  TicketCheck,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { PERMISSIONS } from '@interscale/shared';

// The "Visa Types" item is temporarily hidden from the Masters sidebar
// navigation. Set this back to true to restore it; the route, pages and data
// are untouched.
export const SHOW_VISA_TYPES_MASTER_NAVIGATION = false;

// The "Destination Experts" masters item is temporarily hidden from the UI.
// Set this back to true to restore it; the route, pages, API and database
// data are untouched.
export const SHOW_DESTINATION_EXPERTS_MASTER_NAVIGATION = false;

// The "Quotation Templates" and "Bookings" items are temporarily hidden from
// the sidebar. Set these back to true to restore them; their routes, pages,
// permissions and data are untouched.
export const SHOW_QUOTATION_TEMPLATES_NAVIGATION = false;
export const SHOW_BOOKINGS_NAVIGATION = false;
export const SHOW_ACTIVITY_LOGS_NAVIGATION = false;
export const SHOW_REPORTS_NAVIGATION = false;

// The "Reminders" workspace group (My Reminders, Booking Reminders,
// Notifications, Notification Settings) is a dead product area, hidden from
// the sidebar following the same pattern as Bookings. Set back to true to
// restore it; routes, pages, permissions, APIs and data are untouched.
export const SHOW_REMINDERS_NAVIGATION = false;

// The "FAQs" masters item is hidden from the sidebar navigation. Set this
// back to true to restore it; the route, pages, APIs, permissions and
// database data are untouched.
export const SHOW_FAQS_MASTER_NAVIGATION = false;

// The standalone "Customers" and "Vendors" modules are retired from the
// user-facing UI. Set these back to true to restore them; their routes,
// pages, permissions, APIs and data are untouched.
export const SHOW_CUSTOMERS_NAVIGATION = false;
export const SHOW_VENDORS_NAVIGATION = false;

/**
 * Sister product: WhatsApp Max. Surfaced as a cross-app launcher
 * pinned to the bottom of the sidebar (the Zomato → Blinkit pattern) and opened
 * in a new tab, since it is a separate application on its own domain.
 */
export const WHATSAPP_CRM_URL = 'https://interscalechat.co.in/inbox';

/**
 * Sidebar navigation sections. Items are grouped into these headings so the
 * rail stays scannable. Empty sections are never rendered.
 */
export const NAV_SECTION = {
  GENERAL: 'GENERAL',
  WORKSPACE: 'WORKSPACE',
  SALES: 'SALES',
  VOUCHERS: 'VOUCHERS',
  OPERATIONS: 'OPERATIONS',
  MASTERS: 'MASTERS',
  ADMINISTRATION: 'ADMINISTRATION',
} as const;

export type NavSection = (typeof NAV_SECTION)[keyof typeof NAV_SECTION];

export const NAV_SECTION_ORDER: readonly NavSection[] = [
  NAV_SECTION.GENERAL,
  NAV_SECTION.WORKSPACE,
  NAV_SECTION.SALES,
  NAV_SECTION.VOUCHERS,
  NAV_SECTION.OPERATIONS,
  NAV_SECTION.MASTERS,
  NAV_SECTION.ADMINISTRATION,
];

export const NAV_SECTION_LABELS: Record<NavSection, string> = {
  [NAV_SECTION.GENERAL]: 'General',
  [NAV_SECTION.WORKSPACE]: 'Workspace',
  [NAV_SECTION.SALES]: 'Sales',
  [NAV_SECTION.VOUCHERS]: 'Vouchers',
  [NAV_SECTION.OPERATIONS]: 'Operations',
  [NAV_SECTION.MASTERS]: 'Masters',
  [NAV_SECTION.ADMINISTRATION]: 'Administration',
};

/**
 * The sidebar model.
 *
 * `available: false` renders an item as "Coming soon" — visible so the product
 * shape is clear, but not navigable. `permission` is the key required to see
 * an item at all. `hideForSystemAdmin` removes an item from the System Admin's
 * navigation. `matchPaths` extends active matching for a route that does not
 * share the item's own prefix.
 */
export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  available: boolean;
  permission?: string;
  section: NavSection;
  hideForSystemAdmin?: boolean;
  /** Owner-only items (e.g. SearchAPI usage). Backed by a backend role check. */
  hideUnlessOwner?: boolean;
  matchPaths?: readonly string[];
  children?: readonly NavItem[];
}

export const NAV_ITEMS: readonly NavItem[] = [
  // -------------------------------------------------------------------------
  // General
  // -------------------------------------------------------------------------
  {
    label: 'Dashboard',
    to: '/dashboard',
    icon: LayoutDashboard,
    available: true,
    permission: PERMISSIONS.DASHBOARD_VIEW,
    section: NAV_SECTION.GENERAL,
  },
  {
    label: 'Leads',
    to: '/queries',
    icon: MessageSquare,
    available: true,
    permission: PERMISSIONS.QUERIES_VIEW,
    section: NAV_SECTION.GENERAL,
  },
  {
    label: 'Notes',
    to: '/notes',
    icon: NotebookText,
    available: true,
    permission: PERMISSIONS.QUERIES_VIEW,
    section: NAV_SECTION.GENERAL,
  },

  // -------------------------------------------------------------------------
  // Workspace
  // -------------------------------------------------------------------------
  ...(SHOW_REMINDERS_NAVIGATION
    ? [
        {
          label: 'Reminders',
          to: '/reminders',
          icon: Clock,
          available: true,
          permission: PERMISSIONS.REMINDERS_VIEW,
          section: NAV_SECTION.WORKSPACE,
          children: [
            {
              label: 'My Reminders',
              to: '/reminders',
              icon: BellRing,
              available: true,
              permission: PERMISSIONS.REMINDERS_VIEW,
              section: NAV_SECTION.WORKSPACE,
            },
            {
              label: 'Booking Reminders',
              to: '/reminders/bookings',
              icon: CalendarClock,
              available: true,
              permission: PERMISSIONS.BOOKING_REMINDERS_VIEW,
              section: NAV_SECTION.WORKSPACE,
            },
            {
              label: 'Notifications',
              to: '/reminders/notifications',
              icon: Bell,
              available: true,
              permission: PERMISSIONS.NOTIFICATIONS_VIEW,
              section: NAV_SECTION.WORKSPACE,
            },
            {
              label: 'Notification Settings',
              to: '/reminders/settings',
              icon: Settings2,
              available: true,
              permission: PERMISSIONS.NOTIFICATIONS_SETTINGS,
              section: NAV_SECTION.WORKSPACE,
            },
          ],
        },
      ]
    : []),
  {
    label: 'Live Search',
    to: '/travel-search',
    icon: Search,
    available: true,
    section: NAV_SECTION.WORKSPACE,
    matchPaths: ['/travel-search'],
  },
  {
    label: 'Bookmarks',
    to: '/travel-search/bookmarks',
    icon: Bookmark,
    available: true,
    section: NAV_SECTION.WORKSPACE,
    matchPaths: ['/travel-search/bookmarks'],
  },

  // -------------------------------------------------------------------------
  // Sales
  // -------------------------------------------------------------------------
  ...(SHOW_QUOTATION_TEMPLATES_NAVIGATION
    ? [
        {
          label: 'Quotation Templates',
          to: '/quotation-templates',
          icon: FileStack,
          available: true,
          permission: PERMISSIONS.QUOTATION_TEMPLATES_VIEW,
          section: NAV_SECTION.SALES,
        },
      ]
    : []),
  {
    label: 'Quotations',
    to: '/quotations',
    icon: FileText,
    available: true,
    permission: PERMISSIONS.QUOTATIONS_VIEW,
    section: NAV_SECTION.SALES,
  },
  {
    label: 'Payments',
    to: '/payments',
    icon: Landmark,
    available: true,
    permission: PERMISSIONS.PAYMENTS_VIEW,
    section: NAV_SECTION.SALES,
  },
  {
    label: 'Email',
    to: '/emails',
    icon: Mail,
    available: true,
    permission: PERMISSIONS.EMAILS_VIEW,
    section: NAV_SECTION.SALES,
  },

  // -------------------------------------------------------------------------
  // Vouchers (extensible group: Hotel today, Flight/Transfer/Activity later)
  // -------------------------------------------------------------------------
  {
    label: 'Hotel Vouchers',
    to: '/hotel-vouchers',
    icon: ReceiptText,
    available: true,
    permission: PERMISSIONS.HOTEL_VOUCHERS_VIEW,
    section: NAV_SECTION.VOUCHERS,
  },

  // -------------------------------------------------------------------------
  // Operations
  // -------------------------------------------------------------------------
  ...(SHOW_BOOKINGS_NAVIGATION
    ? [
        {
          label: 'Bookings',
          to: '/bookings',
          icon: TicketCheck,
          available: true,
          permission: PERMISSIONS.BOOKINGS_VIEW,
          section: NAV_SECTION.OPERATIONS,
        },
      ]
    : []),
  ...(SHOW_CUSTOMERS_NAVIGATION
    ? [
        {
          label: 'Customers',
          to: '/customers',
          icon: Users,
          available: true,
          permission: PERMISSIONS.CUSTOMERS_VIEW,
          section: NAV_SECTION.OPERATIONS,
        },
      ]
    : []),
  ...(SHOW_VENDORS_NAVIGATION
    ? [
        {
          label: 'Vendors',
          to: '/vendors',
          icon: Building2,
          available: true,
          permission: PERMISSIONS.VENDORS_VIEW,
          section: NAV_SECTION.OPERATIONS,
        },
      ]
    : []),

  // -------------------------------------------------------------------------
  // Masters
  // -------------------------------------------------------------------------
  {
    label: 'Masters',
    to: '/masters/cities',
    icon: Database,
    available: true,
    permission: PERMISSIONS.MASTERS_VIEW,
    section: NAV_SECTION.MASTERS,
    children: [
      {
        label: 'Cities',
        to: '/masters/cities',
        icon: MapPin,
        available: true,
        permission: PERMISSIONS.MASTER_CITIES_VIEW,
        section: NAV_SECTION.MASTERS,
      },
      {
        label: 'Destinations',
        to: '/masters/destinations',
        icon: Globe2,
        available: true,
        permission: PERMISSIONS.MASTER_DESTINATIONS_VIEW,
        section: NAV_SECTION.MASTERS,
      },
      {
        label: 'Hotels',
        to: '/masters/hotels',
        icon: Hotel,
        available: true,
        permission: PERMISSIONS.MASTER_HOTELS_VIEW,
        section: NAV_SECTION.MASTERS,
      },
      {
        label: 'Airlines',
        to: '/masters/airlines',
        icon: Plane,
        available: true,
        permission: PERMISSIONS.MASTER_AIRLINES_VIEW,
        section: NAV_SECTION.MASTERS,
      },
      {
        label: 'Cruises',
        to: '/masters/cruises',
        icon: Ship,
        available: true,
        permission: PERMISSIONS.MASTER_CRUISES_VIEW,
        section: NAV_SECTION.MASTERS,
      },
      {
        label: 'Vehicles',
        to: '/masters/vehicles',
        icon: BusFront,
        available: true,
        permission: PERMISSIONS.MASTER_VEHICLES_VIEW,
        section: NAV_SECTION.MASTERS,
      },
      {
        label: 'Sightseeing',
        to: '/masters/sightseeing',
        icon: Landmark,
        available: true,
        permission: PERMISSIONS.MASTER_SIGHTSEEING_VIEW,
        section: NAV_SECTION.MASTERS,
      },
      {
        label: 'Add-On Services',
        to: '/masters/add-on-services',
        icon: PackagePlus,
        available: true,
        permission: PERMISSIONS.MASTER_ADD_ON_SERVICES_VIEW,
        section: NAV_SECTION.MASTERS,
      },
      ...(SHOW_DESTINATION_EXPERTS_MASTER_NAVIGATION
        ? [
            {
              label: 'Destination Experts',
              to: '/masters/destination-experts',
              icon: UserRound,
              available: true,
              permission: PERMISSIONS.QUOTATIONS_VIEW,
              section: NAV_SECTION.MASTERS,
            },
          ]
        : []),
      ...(SHOW_FAQS_MASTER_NAVIGATION
        ? [
            {
              label: 'FAQs',
              to: '/masters/faqs',
              icon: FileText,
              available: true,
              permission: PERMISSIONS.MASTER_FAQS_VIEW,
              section: NAV_SECTION.MASTERS,
            },
          ]
        : []),
      ...(SHOW_VISA_TYPES_MASTER_NAVIGATION
        ? [
            {
              label: 'Visa Types',
              to: '/masters/visa-types',
              icon: FileText,
              available: true,
              permission: PERMISSIONS.MASTER_VISA_TYPES_VIEW,
              section: NAV_SECTION.MASTERS,
            },
          ]
        : []),
    ],
  },

  // -------------------------------------------------------------------------
  // Administration
  // -------------------------------------------------------------------------
  {
    label: 'User List',
    to: '/users',
    icon: UserRound,
    available: true,
    permission: PERMISSIONS.USERS_VIEW,
    section: NAV_SECTION.ADMINISTRATION,
  },
  {
    label: 'Roles',
    to: '/roles',
    icon: ShieldCheck,
    available: true,
    permission: PERMISSIONS.ROLES_VIEW,
    section: NAV_SECTION.ADMINISTRATION,
  },
  {
    label: 'Permission Templates',
    to: '/permission-templates',
    icon: KeyRound,
    available: true,
    permission: PERMISSIONS.PERMISSION_TEMPLATES_VIEW,
    section: NAV_SECTION.ADMINISTRATION,
  },
  ...(SHOW_ACTIVITY_LOGS_NAVIGATION
    ? [
        {
          label: 'Activity Logs',
          to: '/activity-logs',
          icon: History,
          available: true,
          permission: PERMISSIONS.ACTIVITY_LOGS_VIEW,
          section: NAV_SECTION.ADMINISTRATION,
        },
      ]
    : []),
  ...(SHOW_REPORTS_NAVIGATION
    ? [
        {
          label: 'Reports',
          to: '/reports',
          icon: ChartNoAxesCombined,
          available: true,
          permission: PERMISSIONS.REPORTS_VIEW,
          section: NAV_SECTION.ADMINISTRATION,
        },
      ]
    : []),
  {
    label: 'Settings',
    to: '/settings',
    icon: Settings,
    available: true,
    permission: PERMISSIONS.SETTINGS_VIEW,
    section: NAV_SECTION.ADMINISTRATION,
  },
] as const;

/**
 * Whether a path matches an item's route. A detail route like `/bookings/123`
 * activates `/bookings`; prefix matching is path-segment aware so
 * `/quotation-templates` never activates `/quotations` (and vice versa).
 */
export function isNavPathActive(
  pathname: string,
  to: string,
  matchPaths?: readonly string[],
): boolean {
  // Live Search (/travel-search) should not stay active when on Bookmarks (/travel-search/bookmarks) – they are siblings
  if (to === '/travel-search' && pathname.startsWith('/travel-search/bookmarks')) {
    return false;
  }
  const matches = (target: string) =>
    pathname === target || pathname.startsWith(target.endsWith('/') ? target : `${target}/`);
  if (matchPaths?.some(matches)) return true;
  return matches(to);
}

/**
 * Whether an item (or any of its children) is active for the current path.
 * Used to keep a collapsible parent visually active while a child route is
 * selected, and to auto-expand the group.
 */
export function isNavItemActive(
  pathname: string,
  item: Pick<NavItem, 'to' | 'matchPaths' | 'children'>,
): boolean {
  if (isNavPathActive(pathname, item.to, item.matchPaths)) return true;
  return Boolean(
    item.children?.some((child) => isNavPathActive(pathname, child.to, child.matchPaths)),
  );
}

/** Initials for the avatar, e.g. "Priya Nair" → "PN". */
export function initialsOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return (parts[0] ?? '').slice(0, 2).toUpperCase();
  return `${parts[0]?.[0] ?? ''}${parts[parts.length - 1]?.[0] ?? ''}`.toUpperCase();
}
