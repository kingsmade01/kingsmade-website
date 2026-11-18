# KINGSMADE Admin v2 foundation

This is a clean, isolated rebuild of the private admin dashboard.

- Worker target: `kingsmade-admin-test` (test environment only)
- D1 target: `kingsmade-admin-v2-db`
- Production Worker and production D1 are not used by this project.
- Existing admin implementation and its D1 database are retained as rollback references.
- Authentication uses Cloudflare Worker secrets; never commit secret values.
- First milestone: verify login, session persistence, logout, and D1 connectivity.
- Subsequent milestones: dashboard metrics, orders, inventory, expenses, customers, CMS, media, and preview/publish workflow.
