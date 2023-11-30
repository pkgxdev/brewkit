#include <stdio.h>
#include "zlib.h"

int main() {
  z_stream strm = {0};
  inflateInit(&strm);
  printf("sup_bro\n");
  return 0;
}
