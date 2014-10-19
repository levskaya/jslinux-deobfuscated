De-obfuscated JSLinux
=========================================================

I wanted to understand how the amazing [JsLinux][1] worked.

However the original was passed through a minifier and was completely incomprehensible in that form.  (Mr Bellard's standards for the code that he open sources is very high.)  I couldn't wait for the proper release of the opus, so in a fit of mania I hand de-obfuscated the codebase (primarily the core cpu-emulation routines and a bit of the rest as well) while studying it over a few days' time.

In the off-chance someone else might be interested in this code as a basis for further weird in-browser x86 hacking I'm posting this
redacted version of the code here, with permission of Mr. Bellard.

Note that there is another ground-up project to build an open-source 386-style emulator in javascript called [jslm32][3]. 
I also recommend looking at the remarkable linux on [jor1k][5] emulator project.

### Status

The current codebase should run on most modern versions of Chrome, Safari, and Firefox.  If you're running it locally, you will need to load it via a local server to allow the XHR requests to load the binaries.

jslinux-deobfuscated is still a dense, messy code base from any pedagogic point of view.  However for those interested in Mr. Bellard's code, 
this version is nowhere near so incomprehensible as the original.  Nearly all of the global variables and function names have been named 
somewhat sensibly.  Many pointers to references have been added to the source.

The core opcode execution loop has been commented to indicate what instruction the opcode refers to.

### Unresolved

One mystery is, why does CPUID(1) return 8 << 8 in EBX? EBX[15:8] is now used to indicate CLFLUSH line size, but that field must have been used for something else in the past.

The CALL/RET/INT/IRET routines are still quite confused and haven't yet been rewritten.  The code dealing with segmentation, and some of the code for real-mode remains relatively messy.

Any recommendations / clarifications are welcome!

### ETC

I highly recommend, by the way, the excellent [JSShaper][2] library for transforming large javascript code bases.  The hacks I made from it are in this repo: a little symbol-name-transformer node.js script and an emacs function for doing this in live buffers.

### License

This is a pedagogical/aesthetic derivative of the original JSLinux code Copyright (c) 2011-2014 Fabrice Bellard.  It is posted here with permission of the original author subject to his original constraints : Redistribution or commercial use is prohibited without the (original) author's permission.

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
[4]: https://bugs.webkit.org/show_bug.cgi?id=72154
[5]: https://github.com/s-macke/jor1k
