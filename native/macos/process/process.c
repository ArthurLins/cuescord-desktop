#include "process.h"
#include <libproc.h>

bool cuescord_process_belongs_to(pid_t process, pid_t owner) {
  for (int count = 0; process > 1 && count < 128; count++) {
    if (process == owner) return true;
    struct proc_bsdinfo info;
    if (proc_pidinfo(process, PROC_PIDTBSDINFO, 0, &info, sizeof(info)) != sizeof(info)) return false;
    if (info.pbi_ppid == process) return false;
    process = info.pbi_ppid;
  }
  return false;
}
