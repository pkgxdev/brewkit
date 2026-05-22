#!/bin/sh
# Template for bklibcvenv-generated wrappers.
#
# Replaced by `bklibcvenv seal`:
#   @LDSO@      e.g. ld-linux-x86-64.so.2
#   @LIBDIR@    e.g. glibc-2.43  (subdir of $prefix/lib/)
#   @LIBC_NAME@ e.g. glibc       (prefix for libexec/<libc>-<dir>/)
#   @DIR@       e.g. bin         (or sbin)

case "$0" in
  */*) bindir=${0%/*} ;;
  *) bindir=$(command -v -- "$0"); bindir=${bindir%/*} ;;
esac

prefix=$(CDPATH= cd -- "$bindir/.." && pwd)
libdir="$prefix/lib/@LIBDIR@"

exec "$libdir/@LDSO@" --library-path "$libdir" "$prefix/libexec/@LIBC_NAME@-@DIR@/$(basename "$0")" "$@"
