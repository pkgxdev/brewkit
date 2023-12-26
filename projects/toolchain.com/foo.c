#include <stdio.h>
#include "zlib.h"

int main() {
  int a;
  a += 1; // creates a warning that we can use with -Werror arg removal

  z_stream strm = {0};
  inflateInit(&strm);
  printf("sup_bro\n");
  return 0;
}
