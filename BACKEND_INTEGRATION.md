# Backend to mobile handoff

Whenever endpoints change: record method/path/auth/request/success/error in `../docs/API_CONTRACT.md`; update service, controller, validator, repository; update mobile DTO/service/mapper/hook/routes as applicable. Test authorization and error states. Record schema/index/migration and dependency changes.

If backend is done but frontend isn't, final status must be PARTIAL; do not report fully implemented. Provide a working reproducible API request and matching mobile demonstration only if actually verified.
