Fabrix - (De-obfuscated) JSLinux
=========================================================

I wanted to understand how the amazing [JsLinux][1] worked.  However,  Mr Bellard seems to have applied a decidedly french proclivity towards obfuscatory algorithmic prose, replete with two-letter variable names and the like... ;)  I have no idea if he passed it through a minifier or if the code was generated algorithmically from stuff in the QEMU codebase.  In any case, it's hard to follow the action as presented originally, let alone extend it to do new tricks.

So in order to better understand the code, I started transforming all the symbols and commenting it up, which isn't all that hard a thing to do given that it's been built to imitate a very well-specified piece of hardware.

In the off-chance someone else might be interested in this code as a
basis for further weird in-browser x86 hacking I'm posting this redacted version of the code here.

### Status

It's still a dense code base, it's an emulator of a rather
complicated architecture, after all.  However this version is nowhere
near so incomprehensible as the original.  Nearly all of the variables
and function names have been named somewhat sensibly.  It's been
heavily commented.  It's all still a bit hectic, but readable.

The core opcode execution loop has been autocommented to indicate what instruction operation the opcode refers to.

I highly recommend, by the way, the excellent [JSShaper][2] library for transforming large javascript code bases.  The hacks I made from it are in this repo: a little symbol-name-transformer node.js script and an emacs function for doing this in live buffers.

### Caveat Coder
This is a pedagogical reinterpretation of the original JSLinux code Copyright (c) 2011 Fabrice Bellard.

There's no alteration in the algorithmic content.  I do check that
that it still runs as the original.

### References
Some other helpful references for understanding what's going on:

#### x86
- http://pdos.csail.mit.edu/6.828/2005/readings/i386/
- http://ref.x86asm.net/coder32.html
- http://en.wikibooks.org/wiki/X86_Assembly/X86_Architecture
- http://en.wikipedia.org/wiki/X86
- http://en.wikipedia.org/wiki/Control_register
- http://en.wikipedia.org/wiki/X86_assembly_language
- http://en.wikipedia.org/wiki/Translation_lookaside_buffer

#### Bit Hacking
- http://graphics.stanford.edu/~seander/bithacks.html

#### Other devices
- http://en.wikibooks.org/wiki/Serial_Programming/8250_UART_Programming

[1]: http://bellard.org/jslinux/tech.html
[2]: http://sshaper.org
