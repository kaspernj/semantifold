// @ts-check

export const task037ServerBytes = "alpha\nbeta\r\n終端"
export const task037ExpectedBytes = "alpha\nbeta\r\n終端\n"

/**
 * Returns the canonical Ruby acceptance source for one fresh loopback endpoint.
 * @param {number} port - Ephemeral server port.
 * @param {boolean} [qualifiedPuts] - Whether to use the supported Kernel.puts form.
 * @returns {string} Complete Ruby source.
 */
export function task037TcpProgram(port, qualifiedPuts = false) {
  const output = qualifiedPuts ? "Kernel.puts(line)" : "puts line"

  return `require "socket"
module Main
  module_function
  # @return [void]
  def run()
    # @type [TCPSocket]
    socket = TCPSocket.new("127.0.0.1", ${port})
    begin
      begin
        begin
          # @type [bool]
          reading = true
          while reading
            # @type [String?]
            line = socket.gets
            if line.nil?
              reading = false
            else
              ${output}
            end
          end
        rescue WriteFailure => write_error
          socket.close
          return
        end
      rescue DecodeFailure => decode_error
        socket.close
        return
      end
    rescue ReadFailure => read_error
      socket.close
      return
    end
    socket.close
    return
  end
  run()
end
`
}

/**
 * Returns a program that exposes the stable category for a genuinely refused loopback endpoint.
 * @param {number} port - Closed loopback port.
 * @returns {string} Complete Ruby source.
 */
export function task037RefusedProgram(port) {
  return `require "socket"
module Main
  module_function
  # @return [void]
  def run()
    begin
      # @type [TCPSocket]
      socket = TCPSocket.new("127.0.0.1", ${port})
      socket.close
    rescue ConnectionFailure => connection_error
      puts "connection-failure"
      return
    end
    return
  end
  run()
end
`
}

/**
 * Returns a source whose constructor arguments expose their effect order before the TCP exchange.
 * @param {number} port - Ephemeral server port.
 * @returns {string} Complete Ruby source.
 */
export function task037OrderedProgram(port) {
  return `require "socket"
module Main
  module_function
  # @return [String]
  def host_value()
    puts "host"
    return "127.0.0.1"
  end
  # @return [Integer]
  def port_value()
    puts "port"
    return ${port}
  end
  # @return [void]
  def run()
    # @type [TCPSocket]
    socket = TCPSocket.new(host_value(), port_value())
    begin
      begin
        begin
          # @type [bool]
          reading = true
          while reading
            # @type [String?]
            line = socket.gets
            if line.nil?
              reading = false
            else
              puts line
            end
          end
        rescue WriteFailure => write_error
          socket.close
          return
        end
      rescue DecodeFailure => decode_error
        socket.close
        return
      end
    rescue ReadFailure => read_error
      socket.close
      return
    end
    socket.close
    return
  end
  run()
end
`
}
