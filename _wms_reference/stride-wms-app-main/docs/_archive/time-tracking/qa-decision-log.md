# Time Tracking / Service Time Q&A Decision Log

This file captures key Q&A decisions made during the time tracking planning.
It is intended to be append-only so we can later convert decisions into a TODO list.

## Estimated service time (from pricing)

**Q57:** For any billable service that has `service_time_minutes`, should the estimated time be `service_time_minutes * quantity`?

**A57:** Yes **when the service is linked to an item** (per-item). For other services, the estimate should follow how that service is billed/assigned (per job/per task, or per quantity assigned).

**Q58:** For services configured as Flat Per Task (`unit=per_task`), should we always treat the multiplier as 1 (estimate = `service_time_minutes`), and if we ever want it multiplied we'd configure the service as Each/Qty instead?

**A58:** Yes.

**Q59:** Should Estimated Service Time be snapshotted onto the job at completion (so later Price List changes don’t alter history)?

**A59:** Yes.

