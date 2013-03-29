De-obfuscated JSLinux
=========================================================

I wanted to understand how the amazing [JsLinux][1] worked.

However the original was passed through a minifier and was completely incomprehensible in that form.  (Mr Bellard's standards for the code that he open sources is very high.)  I couldn't wait for the proper release of the opus, so in a fit of mania I hand de-obfuscated the codebase (primarily the core cpu-emulation
routines and a bit of the rest as well) while studying it over a few days' time.

In the off-chance someone else might be interested in this code as a
basis for further weird in-browser x86 hacking I'm posting this
redacted version of the code here, with permission of Mr. Bellard.

Note that there is a much more readable, ground-up project to build an open-source 386-style emulator in javascript called [jslm32][3].

### Status
It's still a dense code base, it's an emulator of a rather
complicated architecture, after all.  However this version is nowhere
near so incomprehensible as the original.  Nearly all of the global variables
and function names have been named somewhat sensibly.  Many comments
have been added.

It seems to run identically to the original.

The core opcode execution loop has been autocommented to indicate what
instruction operation the opcode refers to.

One mystery is, why does CPUID(1) return 8 << 8 in EBX? EBX[15:8] is now used to indicate CLFLUSH line size, but that field must have been used for something else in the past.

### ETC

I highly recommend, by the way, the excellent [JSShaper][2] library for transforming large javascript code bases.  The hacks I made from it are in this repo: a little symbol-name-transformer node.js script and an emacs function for doing this in live buffers.

### License

This is a pedagogical/aesthetic derivative of the original JSLinux code Copyright (c) 2011-2013 Fabrice Bellard.  It is posted here with permission of the original author subject to his original constraints : Redistribution or commercial use is prohibited without the (original) author's permission.

### References
Some other helpful references for understanding what's going on:

#### x86
- http://pdos.csail.mit.edu/6.828/2005/readings/i386/
- http://pdos.csail.mit.edu/6.828/2010/readings/i386.pdf (PDF of above)
- http://ref.x86asm.net/coder32.html
- http://www.sandpile.org/
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
[2]: http://jsshaper.org
[3]: https://github.com/ubercomp/jslm32
