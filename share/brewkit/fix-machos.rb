#!/usr/bin/env -S pkgx +gem ruby

# using pkgx ruby to try and avoid macos Ruby complexity

require 'bundler/inline'

gemfile do
  source 'https://rubygems.org'
  gem 'ruby-macho', '~> 3'
end

require 'fileutils'
require 'pathname'
require 'macho'
require 'find'

$PKGX_DIR = ENV['PKGX_DIR'] || ENV["HOME"] + "/.pkgx"

$pkg_prefix = ARGV.shift
abort "arg1 should be pkg-prefix" if $pkg_prefix.empty?
$pkg_prefix = Pathname.new($pkg_prefix).realpath.to_s

$inodes = Hash.new


def arm?
  def type
    case RUBY_PLATFORM
    when /arm/, /aarch64/ then true
    else false
    end
  end
end

class Fixer
  def initialize(file)
    @file = MachO.open(file)
  end

  def fix
    case @file.filetype
    when :dylib
      fix_id
      fix_rpaths
      fix_install_names
    when :execute
      fix_rpaths
      fix_install_names
    when :bundle
      fix_rpaths
      fix_install_names
    when :object
      # noop
    else
      throw Error("unknown filetype: #{file.filetype}: #{file.filename}")
    end

    # changing the macho stuff invalidates the signature
    # this resigns with the default adhoc signing profile
    # unless ENV['APPLE_IDENTITY'] is set, in which
    # case it uses that
    codesign!(@file.filename)
  end

  # Copied from https://github.com/Homebrew/ruby-macho/blob/02fa0521f8ce5c749c88d3109d2a8fccf5b3293a/lib/macho.rb#L51-L60C6
  # to take an optional signing identity
  def codesign!(filename)
    raise ArgumentError, "codesign binary is not available on Linux" if RUBY_PLATFORM !~ /darwin/
    raise ArgumentError, "#{filename}: no such file" unless File.file?(filename)

    signing_id = ENV['APPLE_IDENTITY'] || "-"

    _, stderr_str, status = Open3.capture3("codesign", "--sign", signing_id, "--force",
                                  "--preserve-metadata=entitlements,requirements,flags,runtime",
                                  filename)

    # This is messy, but Deno (and Zig, and possibly others) output working binaries
    # that fail strict validation. Deno has an open issue about this since 2018:
    # https://github.com/denoland/deno/issues/575
    # codesign "fails" after correctly signing these binaries with the below error,
    # but the binaries still work.
    raise MachO::CodeSigningError, "#{filename}: signing failed!" unless
      status.success? or
      stderr_str.include?("main executable failed strict validation")
  end

  def fix_id
    rel_path = Pathname.new(@file.filename).relative_path_from(Pathname.new($PKGX_DIR))
    id = "@rpath/#{rel_path}"
    if @file.dylib_id != id
      # only do work if we must
      @file.change_dylib_id id
      write
    end
  end

  def write
    puts "fix-macho: writing #{@file.filename}"
    stat = File.stat(@file.filename)
    if not stat.writable?
      File.chmod(0644, @file.filename)
      chmoded = true
    end
    @file.write!
    @changed = true
  ensure
    File.chmod(stat.mode, @file.filename) if chmoded
  end

  def links_to_other_pkgx_libs?
    @file.linked_dylibs.each do |lib|
      # starts_with? @rpath is not enough lol
      # this because we are setting `id` to @rpath now so it's a reasonable indication
      # that we link to pkgx libs, but the build system for the pkg may well do this for its
      # own libs
      return true if lib.start_with? $PKGX_DIR or lib.start_with? '@rpath'
    end
    return false
  end

  def fix_rpaths
    #TODO remove spurious rpaths

    dirty = false
    rel_path = Pathname.new($PKGX_DIR).relative_path_from(Pathname.new(@file.filename).parent)
    rpath = "@loader_path/#{rel_path}"

    # rewrite any rpaths the tool itself set to be relative
    @file.rpaths.each do |rpath|
      if rpath.start_with? $PKGX_DIR
        diff = Pathname.new(rpath).relative_path_from(Pathname.new(@file.filename).parent)
        new_rpath = "@loader_path/#{diff}"
        if @file.rpaths.include? new_rpath
          @file.delete_rpath rpath
        else
          @file.change_rpath rpath, new_rpath
        end
        dirty = true
      end
    end

    if not @file.rpaths.include? rpath and links_to_other_pkgx_libs?
      @file.add_rpath rpath
      dirty = true
    end

    while @file.rpaths.include? $PKGX_DIR
      @file.delete_rpath $PKGX_DIR
      dirty = true
    end

    write if dirty
  end

  def bad_install_names
    @file.linked_dylibs.map do |lib|
      if lib.start_with? '/'
        if Pathname.new(lib).cleanpath.to_s.start_with? $PKGX_DIR
          lib
        end
      elsif lib.start_with? '@rpath'
        path = Pathname.new(lib.sub(%r{^@rpath}, $PKGX_DIR))
        if path.exist?
          lib
        else
          puts "warn:#{@file.filename}:#{lib}"
        end
      elsif lib.start_with? '@'
        puts "warn:#{@file.filename}:#{lib}"
        # noop
      else
        lib
      end
    end.compact
  end

  def fix_install_names
    bad_names = bad_install_names
    return if bad_names.empty?

    def fix_pkgx_prefix s
      s = Pathname.new(s)
      s = s.realpath if s.symlink?

      shortest = nil
      s.parent.each_child do |file|
        file = s.dirname.join(file)
        if file.symlink? and file.realpath == s and (shortest.nil? or file.basename.to_s.length < shortest.basename.to_s.length)
          shortest = file
        end
      rescue Errno::ENOENT
        # noop realpath failed
      end

      s = shortest if shortest  # if not then just try anyway

      s = s.relative_path_from(Pathname.new($PKGX_DIR))
      s = s.sub(%r{/v(\d+)\.(\d+\.)+\d+[a-z]?/}, '/v\1/')

      abort "#{s} doesn’t exist!" unless File.exist?(File.join($PKGX_DIR, s))

      s = "@rpath/#{s}"

      return s
    end

    bad_names.each do |old_name|
      if old_name.start_with? $pkg_prefix
        new_name = Pathname.new(old_name).relative_path_from(Pathname.new(@file.filename).parent)
        new_name = "@loader_path/#{new_name}"
      elsif old_name.start_with? '/'
        new_name = fix_pkgx_prefix old_name
      elsif old_name.start_with? '@rpath'
        # so far we only feed bad @rpaths that are relative to the pkgx-prefix
        new_name = fix_pkgx_prefix old_name.sub(%r{^@rpath}, $PKGX_DIR)
      else
        # assume they are meant to be relative to lib dir
        new_name = Pathname.new($pkg_prefix).join("lib").relative_path_from(Pathname.new(@file.filename).parent)
        new_name = "@loader_path/#{new_name}/#{old_name}"
      end

      @file.change_install_name old_name, new_name
    end

    write
  end
end

ARGV.each do |arg|
  Find.find(arg) do |file|
    next unless File.file? file and !File.symlink? file
    abs = Pathname.getwd.join(file).to_s
    inode = File.stat(abs).ino
    if $inodes[inode]
      # codesigning breaks the hard link
      # so now we have to re-hardlink
      puts "re-hardlinking #{abs} to #{$inodes[inode]}"
      FileUtils.ln($inodes[inode], abs, :force => true)
      # stuff like git has hardlinks to the same files
      # avoid the work if we already did this inode
      next
    end
    Fixer.new(abs).fix
    $inodes[inode] = abs
  rescue MachO::MagicError
    #noop: not a Mach-O file
  rescue MachO::TruncatedFileError
    #noop: file can’t be a Mach-O file
  end
end
